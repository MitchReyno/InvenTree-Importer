import { and, asc, eq, gt, inArray, notExists, notInArray, sql } from 'drizzle-orm'
import type { DBOSClient } from '@dbos-inc/dbos-sdk'
import type { Pool } from 'pg'
import { validate, type ProcessingCommandV5Dto } from '@invimport/contracts'
import { strictJson } from '@invimport/contracts/json'
import { executeDatabaseQuery, queryDatabase, transaction } from '#/db/database.ts'
import { verifyBytes } from '#/db/authority.ts'
import { commands } from '#/db/schema.ts'
import { captureBatches } from '#/capture/schema.ts'
import type { ProcessingConfig } from '#/processing/attempts.ts'
import { fail } from '#/processing/model.ts'
import { processingAttempts } from '#/processing/schema.ts'
import { sessionCommandQueue, sessionHandlerVersion } from '#/processing/session-policy.ts'
import {
  agentBatchPauses,
  agentSessionCursors,
  agentSessionInbox,
  agentSessions,
} from '#/agents/schema.ts'
import {
  queueSessionResume,
  runSessionTurn,
  settleCancelledIdleSessions,
  type SessionRunnerDeps,
} from './session-runner.ts'

export const SESSION_RESUME_WORKFLOW = 'sessionResume'

/**
 * Runs a session command delivered by the scheduler. The retained command row, not the
 * delivered payload, is the authority: queue, handler, account binding and exact bytes.
 */
export async function executeSessionCommand(
  deps: SessionRunnerDeps,
  workflowId: string,
  payload: unknown,
  signal: AbortSignal,
) {
  validate('ProcessingCommandV5', payload)
  const command = payload as ProcessingCommandV5Dto
  const rows = await executeDatabaseQuery(
    queryDatabase(deps.pool)
      .select({
        workflowId: commands.workflowId,
        queueName: commands.queueName,
        handlerVersion: commands.handlerVersion,
        actorId: commands.actorId,
        targetId: commands.targetId,
        targetContextId: commands.targetContextId,
        payloadBytes: commands.payloadBytes,
        payloadDigest: commands.payloadDigest,
        attemptId: processingAttempts.id,
      })
      .from(commands)
      .innerJoin(processingAttempts, eq(processingAttempts.commandId, commands.id))
      .where(eq(commands.id, command.command_id)),
  )
  const row = rows[0]
  const config = deps.config
  if (
    !row ||
    row.workflowId !== workflowId ||
    row.queueName !== sessionCommandQueue ||
    row.handlerVersion !== sessionHandlerVersion ||
    row.actorId !== config.actorId ||
    row.targetId !== config.targetId ||
    row.targetContextId !== config.targetContextId ||
    row.attemptId !== command.attempt_id
  ) {
    fail('session_command_binding_invalid', 422)
  }
  verifyBytes(row.payloadBytes, row.payloadDigest)
  if (JSON.stringify(strictJson(row.payloadBytes.toString('utf8'))) !== JSON.stringify(payload)) {
    fail('session_command_binding_invalid', 422)
  }
  return runSessionTurn(deps, command.attempt_id, signal)
}

const LIVE_WORKFLOW = new Set(['PENDING', 'ENQUEUED'])
const WAKE_BUCKET_MS = 60_000

async function liveWorkflow(scheduler: DBOSClient, workflowID: string) {
  const status = await scheduler.getWorkflow(workflowID)
  return status ? LIVE_WORKFLOW.has(status.status) : undefined
}

/**
 * Makes sure every session that has work to do has a live workflow. Sessions waiting, finished
 * or interrupted with inbox items after their cursor are re-queued; queued sessions with no live
 * workflow (a turn that settled to queued, a crash between commit and enqueue, a workflow that
 * ended without claiming) get a fresh one. A duplicate run is harmless: only one claim of a
 * queued session can move it to running.
 */
export async function wakePendingSessions(
  pool: Pool,
  config: ProcessingConfig,
  scheduler: DBOSClient,
) {
  const db = queryDatabase(pool)
  // A paused batch's sessions are neither resumed nor woken until Resume.
  const notPaused = notExists(
    db
      .select({ batchId: agentBatchPauses.batchId })
      .from(agentBatchPauses)
      .where(eq(agentBatchPauses.batchId, processingAttempts.batchId)),
  )
  const scope = and(
    eq(commands.actorId, config.actorId),
    eq(commands.targetId, config.targetId),
    eq(commands.targetContextId, config.targetContextId),
  )
  const waiting = await executeDatabaseQuery(
    db
      .selectDistinct({ lineageId: agentSessions.sessionLineageId })
      .from(agentSessions)
      .innerJoin(processingAttempts, eq(processingAttempts.id, agentSessions.attemptId))
      .innerJoin(commands, eq(commands.id, processingAttempts.commandId))
      .innerJoin(captureBatches, eq(captureBatches.id, processingAttempts.batchId))
      .innerJoin(
        agentSessionInbox,
        eq(agentSessionInbox.sessionLineageId, agentSessions.sessionLineageId),
      )
      .where(
        and(
          scope,
          eq(captureBatches.archived, false),
          notPaused,
          // Only a lineage's latest session can be resumed.
          sql`${processingAttempts.number} = (SELECT max(latest.number) FROM ${processingAttempts} latest WHERE latest.job_id = ${processingAttempts.jobId})`,
          inArray(agentSessions.sessionState, ['waiting_input', 'finished', 'interrupted']),
          gt(
            agentSessionInbox.seq,
            sql`COALESCE((SELECT ${agentSessionCursors.ackedSeq} FROM ${agentSessionCursors} WHERE ${agentSessionCursors.sessionLineageId} = ${agentSessions.sessionLineageId}), 0)`,
          ),
        ),
      )
      .orderBy(asc(agentSessions.sessionLineageId))
      .limit(20),
  )
  await settleCancelledIdleSessions(pool, config)
  for (const { lineageId } of waiting) {
    if (lineageId) {
      await transaction(pool, (client) => queueSessionResume(client, lineageId))
    }
  }
  const queued = await executeDatabaseQuery(
    db
      .select({
        attemptId: agentSessions.attemptId,
        lineageId: agentSessions.sessionLineageId,
        turnCount: agentSessions.turnCount,
        workflowId: commands.workflowId,
      })
      .from(agentSessions)
      .innerJoin(processingAttempts, eq(processingAttempts.id, agentSessions.attemptId))
      .innerJoin(commands, eq(commands.id, processingAttempts.commandId))
      .innerJoin(captureBatches, eq(captureBatches.id, processingAttempts.batchId))
      .where(
        and(
          eq(captureBatches.archived, false),
          notPaused,
          scope,
          eq(agentSessions.sessionState, 'queued'),
          notInArray(processingAttempts.state, ['cancelled', 'superseded']),
        ),
      )
      // Oldest first, the same order slot claims use, so workflows do not wait on newer ones.
      .orderBy(asc(agentSessions.queuedSince), asc(agentSessions.attemptId))
      .limit(50),
  )
  let woken = 0
  for (const session of queued) {
    // A first turn not yet delivered or still waiting belongs to its command workflow.
    if (session.turnCount === 0n && (await liveWorkflow(scheduler, session.workflowId)) !== false) {
      continue
    }
    // One wake per minute at most: a queued workflow waits at most 30 seconds for a slot, so a
    // live one is always in this bucket or the previous one.
    const bucket = Math.floor(Date.now() / WAKE_BUCKET_MS)

    const id = (at: number) => `resume:${session.attemptId}:${session.turnCount}:${at}`

    if (
      (await liveWorkflow(scheduler, id(bucket))) ||
      (await liveWorkflow(scheduler, id(bucket - 1)))
    ) {
      continue
    }
    if ((await liveWorkflow(scheduler, id(bucket))) === false) {
      continue
    }
    const workflowID = id(bucket)
    try {
      await scheduler.enqueue(
        {
          workflowID,
          workflowName: SESSION_RESUME_WORKFLOW,
          queueName: sessionCommandQueue,
          appVersion: sessionHandlerVersion,
        },
        session.attemptId,
      )
    } catch (error) {
      if ((await liveWorkflow(scheduler, workflowID)) === undefined) {
        throw error
      }
    }
    woken += 1
  }
  return woken
}
