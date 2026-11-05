import { and, desc, eq } from 'drizzle-orm'
import type { PoolClient } from 'pg'
import { validate, type SessionOutboxItemDto } from '@invimport/contracts'
import { executeDatabaseQuery, queryDatabase } from '../../db/database.ts'
import { agentSessionOutbox, agentSessions } from '../schema.ts'

type OutboxEntry = Pick<SessionOutboxItemDto, 'kind' | 'payload'>

/** Locks the session row so sequences stay gap-free; the trigger refuses any other sequence. */
export async function appendSessionOutbox(
  client: PoolClient,
  sessionId: string,
  entry: OutboxEntry,
) {
  const db = queryDatabase(client)
  await executeDatabaseQuery(
    db
      .select({ attemptId: agentSessions.attemptId })
      .from(agentSessions)
      .where(eq(agentSessions.attemptId, sessionId))
      .for('update'),
  )
  const last = await executeDatabaseQuery(
    db
      .select({ seq: agentSessionOutbox.seq })
      .from(agentSessionOutbox)
      .where(eq(agentSessionOutbox.sessionId, sessionId))
      .orderBy(desc(agentSessionOutbox.seq))
      .limit(1),
  )
  const seq = (last[0]?.seq ?? 0n) + 1n
  validate('SessionOutboxItem', {
    session_id: sessionId,
    seq: seq.toString(),
    created_at: new Date().toISOString(),
    ...entry,
  })
  await executeDatabaseQuery(
    db
      .insert(agentSessionOutbox)
      .values({ sessionId, seq, kind: entry.kind, payload: entry.payload }),
  )
  return seq
}

/** When the session last published a status line, by database time. */
export async function lastStatusAt(client: PoolClient, sessionId: string) {
  const rows = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ createdAt: agentSessionOutbox.createdAt })
      .from(agentSessionOutbox)
      .where(
        and(eq(agentSessionOutbox.sessionId, sessionId), eq(agentSessionOutbox.kind, 'status')),
      )
      .orderBy(desc(agentSessionOutbox.seq))
      .limit(1),
  )
  return rows[0]?.createdAt
}
