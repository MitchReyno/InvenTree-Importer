import type { Pool } from 'pg'
import { and, desc, eq, lt, or } from 'drizzle-orm'
import type { AgentSessionListDto } from '@invimport/contracts'
import { executeDatabaseQuery, queryDatabase, transaction } from '../db/database.ts'
import { commands } from '../db/schema.ts'
import { appendEvent } from '../db/authority.ts'
import {
  processingAttempts,
  processingInputs,
  processingJobs,
  processingLanes,
} from '../processing/schema.ts'
import { captureInTransaction } from '../capture/repository.ts'
import type { ProcessingConfig } from '../processing/attempts.ts'
import { fail } from '../processing/model.ts'
import { decodeJobInput } from '../processing/session-input.ts'
import { agentSessions } from './schema.ts'

const SESSION_PAGE_SIZE = 50

/** History is scoped through command authority, including attempts no longer selected on their job. */
export async function listAgentSessions(
  pool: Pool,
  binding: ProcessingConfig,
  before?: string,
): Promise<AgentSessionListDto> {
  return transaction(pool, async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
    let cursor: { queuedAt: Date; attemptId: string } | undefined
    if (before) {
      const cursors = await executeDatabaseQuery(
        queryDatabase(client)
          .select({ queuedAt: agentSessions.queuedAt, attemptId: agentSessions.attemptId })
          .from(agentSessions)
          .innerJoin(processingAttempts, eq(processingAttempts.id, agentSessions.attemptId))
          .innerJoin(commands, eq(commands.id, processingAttempts.commandId))
          .where(
            and(
              eq(agentSessions.attemptId, before),
              eq(commands.actorId, binding.actorId),
              eq(commands.targetId, binding.targetId),
              eq(commands.targetContextId, binding.targetContextId),
            ),
          ),
      )
      cursor = cursors[0] ?? fail('invalid_session_cursor', 400)
    }
    const rows = await executeDatabaseQuery(
      queryDatabase(client)
        .select({
          session: agentSessions,
          attempt: processingAttempts,
          subjectId: processingJobs.subjectId,
          currentAttemptId: processingJobs.currentAttemptId,
          stage: processingJobs.stage,
          bytes: processingInputs.manifestBytes,
          digest: processingInputs.manifestDigest,
          laneAttempt: processingLanes.attemptId,
        })
        .from(agentSessions)
        .innerJoin(processingAttempts, eq(processingAttempts.id, agentSessions.attemptId))
        .innerJoin(processingInputs, eq(processingInputs.id, processingAttempts.inputId))
        .innerJoin(processingJobs, eq(processingJobs.id, processingAttempts.jobId))
        .innerJoin(commands, eq(commands.id, processingAttempts.commandId))
        .leftJoin(processingLanes, eq(processingLanes.actorId, commands.actorId))
        .where(
          and(
            eq(commands.actorId, binding.actorId),
            eq(commands.targetId, binding.targetId),
            eq(commands.targetContextId, binding.targetContextId),
            cursor
              ? or(
                  lt(agentSessions.queuedAt, cursor.queuedAt),
                  and(
                    eq(agentSessions.queuedAt, cursor.queuedAt),
                    lt(agentSessions.attemptId, cursor.attemptId),
                  ),
                )
              : undefined,
          ),
        )
        .orderBy(desc(agentSessions.queuedAt), desc(agentSessions.attemptId))
        .limit(SESSION_PAGE_SIZE + 1),
    )
    const sessions: AgentSessionListDto['sessions'] = []
    for (const row of rows.slice(0, SESSION_PAGE_SIZE)) {
      const manifest = decodeJobInput(row.bytes, row.digest)
      if (
        manifest.schema_version !== 'bench-intake-input/4' &&
        manifest.schema_version !== 'bench-intake-input/6'
      ) {
        fail('agent_session_binding_invalid', 503)
      }
      sessions.push({
        attempt_id: row.attempt.id,
        batch_id: row.attempt.batchId,
        job_id: row.attempt.jobId,
        subject_id: row.subjectId,
        stage: row.stage,
        state: row.attempt.state,
        latest_on_job: row.currentAttemptId === row.attempt.id,
        selection: manifest.agent,
        settings_revision: manifest.settings_revision,
        queued_at: row.session.queuedAt.toISOString(),
        started_at: row.session.startedAt?.toISOString() ?? null,
        finished_at: row.session.finishedAt?.toISOString() ?? null,
        native_session_id: row.session.nativeSessionId,
        actual_model: row.session.actualModel,
        progress: row.session.progress,
        occupies_lane: row.laneAttempt === row.attempt.id,
      })
    }
    return {
      sessions,
      next_before: rows.length > SESSION_PAGE_SIZE ? sessions.at(-1)!.attempt_id : null,
    }
  })
}

export interface SessionProgress {
  progress: 'starting' | 'responding' | 'settled'
  nativeSessionId?: string
  actualModel?: string
}

export async function recordSessionProgress(
  pool: Pool,
  binding: ProcessingConfig,
  attemptId: string,
  progress: SessionProgress,
) {
  // Metadata is server-owned, bounded and deliberately excludes provider messages, reasoning and errors.
  for (const value of [progress.nativeSessionId, progress.actualModel]) {
    if (value !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(value)) {
      fail('agent_session_metadata_invalid', 422)
    }
  }
  await transaction(pool, async (client) => {
    const attempts = await executeDatabaseQuery(
      queryDatabase(client)
        .select({ batchId: processingAttempts.batchId })
        .from(processingAttempts)
        .innerJoin(commands, eq(commands.id, processingAttempts.commandId))
        .where(
          and(
            eq(processingAttempts.id, attemptId),
            eq(commands.actorId, binding.actorId),
            eq(commands.targetId, binding.targetId),
            eq(commands.targetContextId, binding.targetContextId),
          ),
        ),
    )
    const attempt = attempts[0] ?? fail('attempt_not_found', 404)
    const capture = await captureInTransaction(client, binding, attempt.batchId)
    const changes = {
      ...progress,
      ...(progress.progress === 'starting' ? { startedAt: new Date() } : {}),
      ...(progress.progress === 'settled' ? { finishedAt: new Date() } : {}),
    }
    await executeDatabaseQuery(
      queryDatabase(client)
        .update(agentSessions)
        .set(changes)
        .where(eq(agentSessions.attemptId, attemptId)),
    )
    await appendEvent(client, capture.streamId, 'processing_changed', { batch_id: attempt.batchId })
  })
}
