import { and, desc, eq, inArray, isNotNull, or, sql } from 'drizzle-orm'
import type { PoolClient } from 'pg'
import type { HeaderWorkDto } from '@invimport/contracts'
import { executeDatabaseQuery, queryDatabase } from '#/db/database.ts'
import { commands } from '#/db/schema.ts'
import { agentSessions, agentSlots } from '#/agents/schema.ts'
import {
  processingAttempts,
  processingInputs,
  processingJobs,
  processingLanes,
} from '#/processing/schema.ts'
import { fail } from '#/processing/model.ts'
import { decodeJobInput } from '#/processing/session-input.ts'
import { latestStatuses } from '#/agents/tools/outbox.ts'
import type { ProcessingConfig } from '#/processing/attempts.ts'

/** Filter active/physically occupied attempts before the history-independent limit. */
export async function activeHeaderSessions(
  client: PoolClient,
  binding: ProcessingConfig,
  batchId?: string,
) {
  const rows = await executeDatabaseQuery(
    queryDatabase(client)
      .select({
        session: agentSessions,
        attempt: processingAttempts,
        stage: processingJobs.stage,
        bytes: processingInputs.manifestBytes,
        digest: processingInputs.manifestDigest,
        laneAttempt: processingLanes.attemptId,
        slotAttempt: agentSlots.attemptId,
      })
      .from(agentSessions)
      .innerJoin(processingAttempts, eq(processingAttempts.id, agentSessions.attemptId))
      .innerJoin(processingInputs, eq(processingInputs.id, processingAttempts.inputId))
      .innerJoin(processingJobs, eq(processingJobs.id, processingAttempts.jobId))
      .innerJoin(commands, eq(commands.id, processingAttempts.commandId))
      .leftJoin(processingLanes, eq(processingLanes.actorId, commands.actorId))
      .leftJoin(agentSlots, eq(agentSlots.attemptId, agentSessions.attemptId))
      .where(
        and(
          eq(commands.actorId, binding.actorId),
          eq(commands.targetId, binding.targetId),
          eq(commands.targetContextId, binding.targetContextId),
          or(
            eq(processingLanes.attemptId, processingAttempts.id),
            // A slot holder stays visible even after a cancel, until its child is reaped.
            isNotNull(agentSlots.attemptId),
            inArray(processingAttempts.state, ['queued', 'running']),
            // A session waiting for an answer is listed, labelled as holding no slot.
            eq(agentSessions.sessionState, 'waiting_input'),
          ),
        ),
      )
      .orderBy(
        desc(
          sql`CASE WHEN ${processingLanes.attemptId} = ${processingAttempts.id} OR ${agentSlots.attemptId} IS NOT NULL THEN 1 ELSE 0 END`,
        ),
        desc(sql`CASE WHEN ${processingAttempts.batchId} = ${batchId ?? null} THEN 1 ELSE 0 END`),
        desc(agentSessions.queuedAt),
        desc(agentSessions.attemptId),
      )
      .limit(51),
  )
  const statuses = await latestStatuses(
    client,
    rows.slice(0, 50).map((row) => row.attempt.id),
  )
  const sessions: HeaderWorkDto['active_sessions'] = []
  for (const row of rows.slice(0, 50)) {
    const input = decodeJobInput(row.bytes, row.digest)
    if (
      input.schema_version !== 'bench-intake-input/4' &&
      input.schema_version !== 'bench-intake-input/6'
    ) {
      fail('agent_session_binding_invalid', 503)
    }
    sessions.push({
      attempt_id: row.attempt.id,
      batch_id: row.attempt.batchId,
      job_id: row.attempt.jobId,
      stage: row.stage,
      state: row.attempt.state,
      selection: input.agent,
      actual_model: row.session.actualModel,
      progress: row.session.progress,
      occupies_lane: row.laneAttempt === row.attempt.id || row.slotAttempt === row.attempt.id,
      session_state: row.session.sessionState,
      latest_status: statuses.get(row.attempt.id) ?? null,
    })
  }
  return { sessions, truncated: rows.length > 50 }
}
