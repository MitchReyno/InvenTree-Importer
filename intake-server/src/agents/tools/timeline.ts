import { and, asc, desc, eq } from 'drizzle-orm'
import type { Pool } from 'pg'
import {
  validate,
  type SessionInboxItemDto,
  type SessionOutboxItemDto,
  type SessionTimelineDto,
} from '@invimport/contracts'
import { executeDatabaseQuery, queryDatabase } from '../../db/database.ts'
import { commands } from '../../db/schema.ts'
import type { ProcessingConfig } from '../../processing/attempts.ts'
import { fail } from '../../processing/model.ts'
import { processingAttempts, processingJobs } from '../../processing/schema.ts'
import { agentSessionInbox, agentSessionOutbox, agentSessions } from '../schema.ts'

const TIMELINE_LIMIT = 500

/** A job's session history across its attempts, scoped to the batch and the caller's account. */
export async function readSessionTimeline(
  pool: Pool,
  config: ProcessingConfig,
  batchId: string,
  jobId: string,
): Promise<SessionTimelineDto> {
  const db = queryDatabase(pool)
  const sessions = await executeDatabaseQuery(
    db
      .select({ attemptId: agentSessions.attemptId, state: agentSessions.sessionState })
      .from(agentSessions)
      .innerJoin(processingAttempts, eq(processingAttempts.id, agentSessions.attemptId))
      .innerJoin(processingJobs, eq(processingJobs.id, processingAttempts.jobId))
      .innerJoin(commands, eq(commands.id, processingAttempts.commandId))
      .where(
        and(
          eq(agentSessions.sessionLineageId, jobId),
          eq(processingJobs.batchId, batchId),
          eq(commands.actorId, config.actorId),
          eq(commands.targetId, config.targetId),
          eq(commands.targetContextId, config.targetContextId),
        ),
      )
      .orderBy(desc(processingAttempts.number))
      .limit(1),
  )
  const latest = sessions[0]
  if (!latest?.state) {
    fail('session_not_found', 404)
  }
  const outbox = await executeDatabaseQuery(
    db
      .select({
        sessionId: agentSessionOutbox.sessionId,
        seq: agentSessionOutbox.seq,
        kind: agentSessionOutbox.kind,
        payload: agentSessionOutbox.payload,
        createdAt: agentSessionOutbox.createdAt,
      })
      .from(agentSessionOutbox)
      .innerJoin(agentSessions, eq(agentSessions.attemptId, agentSessionOutbox.sessionId))
      .where(eq(agentSessions.sessionLineageId, jobId))
      .orderBy(asc(agentSessionOutbox.createdAt), asc(agentSessionOutbox.seq))
      .limit(TIMELINE_LIMIT),
  )
  const inbox = await executeDatabaseQuery(
    db
      .select()
      .from(agentSessionInbox)
      .where(eq(agentSessionInbox.sessionLineageId, jobId))
      .orderBy(asc(agentSessionInbox.seq))
      .limit(TIMELINE_LIMIT),
  )
  const timeline = {
    job_id: jobId,
    attempt_id: latest!.attemptId,
    session_state: latest!.state!,
    outbox: outbox.map(
      (item) =>
        ({
          session_id: item.sessionId,
          seq: item.seq.toString(),
          kind: item.kind,
          payload: item.payload,
          created_at: item.createdAt.toISOString(),
        }) as SessionOutboxItemDto,
    ),
    inbox: inbox.map(
      (item) =>
        ({
          id: item.id,
          seq: item.seq.toString(),
          kind: item.kind,
          payload: item.payload,
          created_at: item.createdAt.toISOString(),
        }) as SessionInboxItemDto,
    ),
  }
  validate('SessionTimeline', timeline)
  return timeline
}
