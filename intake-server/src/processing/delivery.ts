import type { DBOSClient } from '@dbos-inc/dbos-sdk'
import type { Pool } from 'pg'
import { transaction } from '../db/database.ts'
import { prepareMediaTransaction } from '../media/transaction.ts'
import { deliverCommand } from '../workers/delivery.ts'
import { acceptEnvelope } from './messages.ts'
import {
  claimProcessingCommand,
  interruptProcessing,
  type RestrictedResearchRunner,
} from './runner.ts'
import type { ProcessingConfig } from './attempts.ts'
import { fail, mediaHandlerVersion, mediaProfileId } from './model.ts'

/** Scheduler delivery is payload-bound; account/attempt authority is checked again by the worker. */
export async function dispatchProcessingCommands(
  pool: Pool,
  scheduler: DBOSClient,
  config: ProcessingConfig,
) {
  const commands = await transaction(pool, async (client) => {
    await prepareMediaTransaction(client)
    const retained = await client.query<{ command_id: string }>(
      `SELECT attempt.command_id
     FROM processing_attempt attempt
     JOIN processing_job job ON job.current_attempt_id=attempt.id
     JOIN command command ON command.id=attempt.command_id
     JOIN outbox outbox ON outbox.command_id=command.id
     WHERE command.actor_id=$1 AND command.target_id=$2 AND command.target_context_id=$3
       AND command.handler_version=$4 AND attempt.state='queued' AND outbox.acked_at IS NULL AND outbox.conflict_code IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM processing_dependency dependency
         JOIN processing_attempt predecessor ON predecessor.id=dependency.dependency_attempt_id
         JOIN processing_job predecessor_job ON predecessor_job.id=predecessor.job_id
         WHERE dependency.attempt_id=attempt.id
           AND (predecessor.state<>'ready' OR predecessor_job.current_attempt_id<>predecessor.id))
     ORDER BY command.created_at,command.id LIMIT 10`,
      [config.actorId, config.targetId, config.targetContextId, mediaHandlerVersion],
    )
    return retained.rows
  })

  for (const command of commands) {
    await deliverCommand(pool, scheduler, command.command_id)
  }

  return commands.length
}

/** No provider is constructed here. The caller supplies one already-qualified restricted adapter. */
export async function executeProcessingCommand(
  pool: Pool,
  config: ProcessingConfig,
  workflowId: string,
  payload: unknown,
  runner: RestrictedResearchRunner,
) {
  if (runner.profileId !== mediaProfileId || runner.qualification !== 'fixture_only') {
    fail('unsupported_runner_profile', 422)
  }

  const command = await claimProcessingCommand(
    pool,
    config,
    workflowId,
    payload,
    mediaHandlerVersion,
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
  } catch {
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
