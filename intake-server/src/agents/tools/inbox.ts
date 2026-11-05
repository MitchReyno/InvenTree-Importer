import { randomUUID } from 'node:crypto'
import { and, asc, count, desc, eq, gt, sql } from 'drizzle-orm'
import type { Pool, PoolClient } from 'pg'
import {
  validate,
  type SessionInboxItemDto,
  type SessionInboxReceiptDto,
} from '@invimport/contracts'
import { canonical } from '@invimport/contracts/json'
import { executeDatabaseQuery, queryDatabase, transaction } from '../../db/database.ts'
import { appendEvent } from '../../db/authority.ts'
import { captureBatches } from '../../capture/schema.ts'
import { processingJobs } from '../../processing/schema.ts'
import { fail } from '../../processing/model.ts'
import { agentSessionCursors, agentSessionInbox, agentSessions } from '../schema.ts'
import type { CaptureBinding } from '../../capture/repository.ts'

export const INBOX_READ_LIMIT = 20

type InboxEntry = Pick<SessionInboxItemDto, 'kind' | 'payload'>

export interface InboxSubmission {
  /** The caller's account scope; the session's batch must belong to it. */
  binding: CaptureBinding
  /** When given, the session must belong to this batch. */
  batchId?: string
  lineageId: string
  /** Null for notices the system generates, such as new evidence. */
  actorId: string | null
  idempotencyKey: string
  kind: InboxEntry['kind']
  payload: InboxEntry['payload']
}

/**
 * Accepts an item at once, whatever the session is doing. A repeated key with the same item
 * returns the original receipt; the same key with a different item is a conflict.
 */
export async function appendSessionInbox(
  client: PoolClient,
  submission: InboxSubmission,
  /** False when the caller publishes its own batch event last. */
  { publish = true }: { publish?: boolean } = {},
): Promise<SessionInboxReceiptDto> {
  const db = queryDatabase(client)
  const jobs = await executeDatabaseQuery(
    db
      .select({
        batchId: processingJobs.batchId,
        streamId: captureBatches.streamId,
        actorId: captureBatches.actorId,
        targetId: captureBatches.targetId,
        targetContextId: captureBatches.targetContextId,
      })
      .from(processingJobs)
      .innerJoin(captureBatches, eq(captureBatches.id, processingJobs.batchId))
      .where(eq(processingJobs.id, submission.lineageId))
      .for('update', { of: processingJobs }),
  )
  const job = jobs[0]
  const hasSession = await executeDatabaseQuery(
    db
      .select({ attemptId: agentSessions.attemptId })
      .from(agentSessions)
      .where(eq(agentSessions.sessionLineageId, submission.lineageId))
      .limit(1),
  )
  const outOfScope =
    !job ||
    job.actorId !== submission.binding.actorId ||
    job.targetId !== submission.binding.targetId ||
    job.targetContextId !== submission.binding.targetContextId
  if (
    outOfScope ||
    !hasSession.length ||
    (submission.batchId && job.batchId !== submission.batchId)
  ) {
    fail('session_not_found', 404)
  }
  const existing = await executeDatabaseQuery(
    db
      .select()
      .from(agentSessionInbox)
      .where(
        and(
          eq(agentSessionInbox.sessionLineageId, submission.lineageId),
          eq(agentSessionInbox.idempotencyKey, submission.idempotencyKey),
        ),
      ),
  )
  if (existing[0]) {
    const same =
      existing[0].kind === submission.kind &&
      canonical(existing[0].payload) === canonical(submission.payload) &&
      existing[0].actorId === submission.actorId
    if (!same) {
      fail('idempotency_conflict', 409)
    }
    return { item_id: existing[0].id, seq: existing[0].seq.toString() }
  }
  const last = await executeDatabaseQuery(
    db
      .select({ seq: agentSessionInbox.seq })
      .from(agentSessionInbox)
      .where(eq(agentSessionInbox.sessionLineageId, submission.lineageId))
      .orderBy(desc(agentSessionInbox.seq))
      .limit(1),
  )
  const seq = (last[0]?.seq ?? 0n) + 1n
  const id = randomUUID()
  validate('SessionInboxItem', {
    id,
    seq: seq.toString(),
    created_at: new Date().toISOString(),
    kind: submission.kind,
    payload: submission.payload,
  })
  await executeDatabaseQuery(
    db.insert(agentSessionInbox).values({
      id,
      sessionLineageId: submission.lineageId,
      seq,
      kind: submission.kind,
      payload: submission.payload,
      idempotencyKey: submission.idempotencyKey,
      actorId: submission.actorId,
    }),
  )
  if (publish) {
    await appendEvent(client, job.streamId, 'session_inbox_changed', { batch_id: job.batchId })
  }
  return { item_id: id, seq: seq.toString() }
}

export function submitSessionInbox(pool: Pool, submission: InboxSubmission) {
  return transaction(pool, (client) => appendSessionInbox(client, submission))
}

async function ackedSeq(client: PoolClient, lineageId: string) {
  const rows = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ ackedSeq: agentSessionCursors.ackedSeq })
      .from(agentSessionCursors)
      .where(eq(agentSessionCursors.sessionLineageId, lineageId)),
  )
  return rows[0]?.ackedSeq ?? 0n
}

/** Items after the acknowledged cursor; they stay pending until a later cursor passes them. */
export async function pendingSessionInbox(client: PoolClient, lineageId: string) {
  const rows = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ pending: count() })
      .from(agentSessionInbox)
      .where(
        and(
          eq(agentSessionInbox.sessionLineageId, lineageId),
          gt(agentSessionInbox.seq, await ackedSeq(client, lineageId)),
        ),
      ),
  )
  return Number(rows[0]?.pending ?? 0)
}

/**
 * Acknowledges every item up to `afterSeq` (never past the last item, never backwards) and
 * returns the next unacknowledged items with their stable IDs, so a lost response redelivers.
 */
export async function readSessionInbox(client: PoolClient, lineageId: string, afterSeq: bigint) {
  const db = queryDatabase(client)
  const newest = await executeDatabaseQuery(
    db
      .select({ seq: agentSessionInbox.seq })
      .from(agentSessionInbox)
      .where(eq(agentSessionInbox.sessionLineageId, lineageId))
      .orderBy(desc(agentSessionInbox.seq))
      .limit(1),
  )
  const acknowledge = afterSeq < (newest[0]?.seq ?? 0n) ? afterSeq : (newest[0]?.seq ?? 0n)
  await executeDatabaseQuery(
    db
      .insert(agentSessionCursors)
      .values({ sessionLineageId: lineageId, ackedSeq: acknowledge, ackedAt: new Date() })
      .onConflictDoUpdate({
        target: agentSessionCursors.sessionLineageId,
        set: {
          ackedSeq: sql`GREATEST(${agentSessionCursors.ackedSeq}, excluded.acked_seq)`,
          ackedAt: sql`CASE WHEN excluded.acked_seq > ${agentSessionCursors.ackedSeq} THEN excluded.acked_at ELSE ${agentSessionCursors.ackedAt} END`,
        },
      }),
  )
  const acked = await ackedSeq(client, lineageId)
  const rows = await executeDatabaseQuery(
    db
      .select()
      .from(agentSessionInbox)
      .where(
        and(eq(agentSessionInbox.sessionLineageId, lineageId), gt(agentSessionInbox.seq, acked)),
      )
      .orderBy(asc(agentSessionInbox.seq))
      .limit(INBOX_READ_LIMIT),
  )
  return rows.map(
    (row) =>
      ({
        id: row.id,
        seq: row.seq.toString(),
        kind: row.kind,
        payload: row.payload,
        created_at: row.createdAt.toISOString(),
      }) as SessionInboxItemDto,
  )
}

export async function sessionInboxItem(client: PoolClient, lineageId: string, itemId: string) {
  const rows = await executeDatabaseQuery(
    queryDatabase(client)
      .select({
        id: agentSessionInbox.id,
        kind: agentSessionInbox.kind,
        payload: agentSessionInbox.payload,
      })
      .from(agentSessionInbox)
      .where(
        and(eq(agentSessionInbox.sessionLineageId, lineageId), eq(agentSessionInbox.id, itemId)),
      ),
  )
  return rows[0]
}
