import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm'
import type { DBOSClient } from '@dbos-inc/dbos-sdk'
import type { Pool } from 'pg'
import { validate, type ProcessingCommandV5Dto } from '@invimport/contracts'
import { strictJson } from '@invimport/contracts/json'
import { executeDatabaseQuery, queryDatabase, transaction } from '../db/database.ts'
import { verifyBytes } from '../db/authority.ts'
import { commands } from '../db/schema.ts'
import type { ProcessingConfig } from '../processing/attempts.ts'
import { fail } from '../processing/model.ts'
import { processingAttempts } from '../processing/schema.ts'
import { sessionCommandQueue, sessionHandlerVersion } from '../processing/session-policy.ts'
import { agentSessionCursors, agentSessionInbox, agentSessions } from './schema.ts'
import { queueSessionResume, runSessionTurn, type SessionRunnerDeps } from './session-runner.ts'

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

/**
 * Wakes sessions that are not running but have inbox items after their cursor. Each wake has a
 * workflow ID keyed by lineage and inbox high-water mark, so a repeated wake is a no-op.
 */
export async function wakePendingSessions(
  pool: Pool,
  config: ProcessingConfig,
  scheduler: DBOSClient,
) {
  const candidates = await executeDatabaseQuery(
    queryDatabase(pool)
      .selectDistinct({ lineageId: agentSessions.sessionLineageId })
      .from(agentSessions)
      .innerJoin(processingAttempts, eq(processingAttempts.id, agentSessions.attemptId))
      .innerJoin(commands, eq(commands.id, processingAttempts.commandId))
      .innerJoin(
        agentSessionInbox,
        eq(agentSessionInbox.sessionLineageId, agentSessions.sessionLineageId),
      )
      .where(
        and(
          eq(commands.actorId, config.actorId),
          eq(commands.targetId, config.targetId),
          eq(commands.targetContextId, config.targetContextId),
          inArray(agentSessions.sessionState, ['waiting_input', 'finished', 'interrupted']),
          gt(
            agentSessionInbox.seq,
            sql`COALESCE((SELECT ${agentSessionCursors.ackedSeq} FROM ${agentSessionCursors} WHERE ${agentSessionCursors.sessionLineageId} = ${agentSessions.sessionLineageId}), 0)`,
          ),
        ),
      )
      .limit(20),
  )
  let woken = 0
  for (const { lineageId } of candidates) {
    if (!lineageId) {
      continue
    }
    const wake = await transaction(pool, async (client) => {
      const attemptId = await queueSessionResume(client, lineageId)
      const newest = await executeDatabaseQuery(
        queryDatabase(client)
          .select({ seq: agentSessionInbox.seq })
          .from(agentSessionInbox)
          .where(eq(agentSessionInbox.sessionLineageId, lineageId))
          .orderBy(desc(agentSessionInbox.seq))
          .limit(1),
      )
      return attemptId ? { attemptId, highWater: newest[0].seq } : undefined
    })
    if (!wake) {
      continue
    }
    const workflowID = `resume:${lineageId}:${wake.highWater}`
    try {
      await scheduler.enqueue(
        {
          workflowID,
          workflowName: SESSION_RESUME_WORKFLOW,
          queueName: sessionCommandQueue,
          appVersion: sessionHandlerVersion,
        },
        wake.attemptId,
      )
    } catch (error) {
      if (!(await scheduler.getWorkflow(workflowID))) {
        throw error
      }
    }
    woken += 1
  }
  return woken
}
