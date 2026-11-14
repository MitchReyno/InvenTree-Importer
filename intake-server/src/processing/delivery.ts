import { processingHandler, runnerQualificationMatches } from '#/agents/profile.ts'
import type { DBOSClient } from '@dbos-inc/dbos-sdk'
import type { Pool } from 'pg'
import { and, eq, isNull, ne, notExists, or } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { executeDatabaseQuery, queryDatabase, transaction } from '#/db/database.ts'
import { commands, outbox } from '#/db/schema.ts'
import { processingAttempts, processingDependencies, processingJobs } from './schema.ts'
import { prepareMediaTransaction } from '#/media/transaction.ts'
import { deliverCommand } from '#/workers/delivery.ts'
import { acceptEnvelope } from './messages.ts'
import {
  claimProcessingCommand,
  interruptProcessing,
  type RestrictedResearchRunner,
} from './runner.ts'
import type { ProcessingConfig } from './attempts.ts'
import { fail } from './model.ts'
import { ResearchReapPendingError } from '#/research/errors.ts'

/** Scheduler delivery is payload-bound; account/attempt authority is checked again by the worker. */
export async function dispatchProcessingCommands(
  pool: Pool,
  scheduler: DBOSClient,
  config: ProcessingConfig,
) {
  const actualHandlerVersion = processingHandler(config.profileId)
  const pending = await transaction(pool, async (client) => {
    await prepareMediaTransaction(client)
    const predecessorAttempts = alias(processingAttempts, 'predecessor')
    const predecessorJobs = alias(processingJobs, 'predecessor_job')
    return executeDatabaseQuery(
      queryDatabase(client)
        .select({ commandId: processingAttempts.commandId })
        .from(processingAttempts)
        .innerJoin(processingJobs, eq(processingJobs.currentAttemptId, processingAttempts.id))
        .innerJoin(commands, eq(commands.id, processingAttempts.commandId))
        .innerJoin(outbox, eq(outbox.commandId, commands.id))
        .where(
          and(
            eq(commands.actorId, config.actorId),
            eq(commands.targetId, config.targetId),
            eq(commands.targetContextId, config.targetContextId),
            eq(commands.handlerVersion, actualHandlerVersion),
            eq(processingAttempts.state, 'queued'),
            isNull(outbox.ackedAt),
            isNull(outbox.conflictCode),
            notExists(
              queryDatabase(client)
                .select({ attemptId: processingDependencies.attemptId })
                .from(processingDependencies)
                .innerJoin(
                  predecessorAttempts,
                  eq(predecessorAttempts.id, processingDependencies.dependencyAttemptId),
                )
                .innerJoin(predecessorJobs, eq(predecessorJobs.id, predecessorAttempts.jobId))
                .where(
                  and(
                    eq(processingDependencies.attemptId, processingAttempts.id),
                    or(
                      ne(predecessorAttempts.state, 'ready'),
                      ne(predecessorJobs.currentAttemptId, predecessorAttempts.id),
                    ),
                  ),
                ),
            ),
          ),
        )
        .orderBy(commands.createdAt, commands.id)
        .limit(10),
    )
  })

  for (const command of pending) {
    await deliverCommand(pool, scheduler, command.commandId)
  }

  return pending.length
}

/** No provider is constructed here. The caller supplies one already-qualified restricted adapter. */
export async function executeProcessingCommand(
  pool: Pool,
  config: ProcessingConfig,
  workflowId: string,
  payload: unknown,
  runner: RestrictedResearchRunner,
) {
  if (!runnerQualificationMatches(runner.profileId, runner.qualification)) {
    fail('unsupported_runner_profile', 422)
  }
  const actualHandlerVersion = processingHandler(runner.profileId)

  const command = await claimProcessingCommand(
    pool,
    config,
    workflowId,
    payload,
    actualHandlerVersion,
  )
  if (!command) {
    // Recovery never replays an already claimed native session or substitutes a newer attempt.
    return { state: 'not_claimed' }
  }

  const { channelToken, ...runnerInput } = command
  try {
    await runner.run(runnerInput, async (message) => {
      await acceptEnvelope(pool, config, channelToken, message)
    })
  } catch (error) {
    if (error instanceof ResearchReapPendingError) {
      fail('research_reap_unconfirmed', 503)
    }
    // The adapter has returned/failed. Raw provider errors and source text stay out of public errors.
    await interruptProcessing(pool, config, command.payload.attempt_id)
    fail('research_runner_interrupted')
  }

  const attempts = await pool.query<{ state: string }>(
    'SELECT state FROM public.processing_attempt WHERE id=$1',
    [command.payload.attempt_id],
  )
  const lanes = await pool.query<{ attempt_id: string }>(
    'SELECT attempt_id FROM public.processing_lane WHERE actor_id=$1 AND attempt_id=$2',
    [config.actorId, command.payload.attempt_id],
  )
  if (attempts.rows[0]?.state === 'running' || lanes.rowCount) {
    await interruptProcessing(pool, config, command.payload.attempt_id)
    fail('research_runner_missing_terminal')
  }

  return { state: attempts.rows[0]?.state ?? 'interrupted' }
}
