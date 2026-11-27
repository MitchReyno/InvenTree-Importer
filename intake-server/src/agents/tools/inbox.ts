import { randomUUID } from 'node:crypto'
import { and, asc, count, desc, eq, gt, sql } from 'drizzle-orm'
import type { Pool, PoolClient } from 'pg'
import {
  validate,
  type RevisionChangeDto,
  type SessionInboxItemDto,
  type SessionInboxReceiptDto,
  type SessionRevisionV2Dto,
} from '@invimport/contracts'
import { versionRemovedSql } from '#/media/removal.ts'
import { canonicalRecord } from '@invimport/contracts/json'
import { executeDatabaseQuery, queryDatabase, transaction } from '#/db/database.ts'
import { appendEvent } from '#/db/authority.ts'
import { captureBatches } from '#/capture/schema.ts'
import { processingJobs } from '#/processing/schema.ts'
import { fail } from '#/processing/model.ts'
import {
  agentSessionAcks,
  agentSessionCursors,
  agentSessionInbox,
  agentSessions,
} from '#/agents/schema.ts'
import type { CaptureBinding } from '#/capture/model.ts'

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
  // Capture first: share-lock the job's batch so a concurrent archive is ordered before or after.
  const owner = await executeDatabaseQuery(
    db
      .select({ batchId: processingJobs.batchId })
      .from(processingJobs)
      .where(eq(processingJobs.id, submission.lineageId)),
  )
  if (owner[0]) {
    await executeDatabaseQuery(
      db
        .select({ id: captureBatches.id })
        .from(captureBatches)
        .where(eq(captureBatches.id, owner[0].batchId))
        .for('share'),
    )
  }
  const jobs = await executeDatabaseQuery(
    db
      .select({
        batchId: processingJobs.batchId,
        streamId: captureBatches.streamId,
        actorId: captureBatches.actorId,
        targetId: captureBatches.targetId,
        targetContextId: captureBatches.targetContextId,
        archived: captureBatches.archived,
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
      canonicalRecord(existing[0].payload) === canonicalRecord(submission.payload) &&
      existing[0].actorId === submission.actorId
    if (!same) {
      fail('idempotency_conflict', 409)
    }
    return { item_id: existing[0].id, seq: existing[0].seq.toString() }
  }
  // An archived batch takes no new input, so nothing wakes a session for it.
  if (job.archived) {
    fail('batch_archived', 409)
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
  if (submission.actorId === null) {
    // A system notice names only the columns system roles may write; Drizzle would list
    // actor_id and created_at too, and granting those would let them forge operator chat.
    await client.query(
      `INSERT INTO public.agent_session_inbox(id,session_lineage_id,seq,kind,payload,idempotency_key)
       VALUES($1,$2,$3,$4,$5,$6)`,
      [
        id,
        submission.lineageId,
        seq.toString(),
        submission.kind,
        submission.payload,
        submission.idempotencyKey,
      ],
    )
  } else {
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
  }
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

/**
 * Holds for an inbox item that may still be given to its session: one not withdrawn (a retired
 * group's instruction a stage session hadn't read). Every reader of pending items applies it.
 */
export function deliverableInboxItem() {
  return sql`NOT EXISTS (SELECT 1 FROM public.agent_session_inbox_withdrawal w WHERE w.item_id = ${agentSessionInbox.id})`
}

/**
 * Takes the batch's share lock, as an ungroup that withdraws items holds it, so an item is either
 * withdrawn before it is given or given before any withdrawal.
 */
export async function lockInboxBatch(client: PoolClient, lineageId: string) {
  await client.query(
    `SELECT 1 FROM public.capture_batch b JOIN public.processing_job j ON j.batch_id=b.id
      WHERE j.id=$1 FOR SHARE OF b`,
    [lineageId],
  )
}

/** Records group instruction items as given to their session, so an ungroup can't withdraw them. */
export async function releaseInboxItems(client: PoolClient, itemIds: readonly string[]) {
  if (!itemIds.length) {
    return
  }
  await client.query(
    `INSERT INTO public.agent_session_inbox_release(item_id)
     SELECT i.id FROM public.agent_session_inbox i
      WHERE i.id = ANY($1::uuid[]) AND i.kind='instruction' AND i.payload->>'group_id' IS NOT NULL
     ON CONFLICT (item_id) DO NOTHING`,
    [itemIds],
  )
}

/**
 * An item's payload as it is given now. A `/7` revision naming what an observation shows (its
 * reading, inline or left to the brief, crop, count or same-item mark) when the operator has since
 * removed its evidence names that evidence's removal instead, as the brief leaves it out; the stored item, and the history, keep what was recorded.
 */
export async function deliverablePayload(client: PoolClient, kind: string, payload: unknown) {
  const revision = payload as Partial<SessionRevisionV2Dto>
  if (kind !== 'revision' || revision.schema_version !== 'bench-intake-revision/2') {
    return payload
  }

  // Every change that says what an observation shows: its reading, its crop, its count or the
  // observation it shows the same item as.
  const shownBy = new Set(['reading', 'reading_in_brief', 'region', 'count'])

  const observationsOf = (change: RevisionChangeDto): string[] => {
    if (change.kind === 'same_item') {
      return [change.observation_id, change.same_as_from, change.same_as_to].filter(
        (id): id is string => id !== null,
      )
    }
    return shownBy.has(change.kind) && 'observation_id' in change ? [change.observation_id] : []
  }

  const read = revision.changes!.flatMap(observationsOf)
  if (!read.length) {
    return payload
  }
  const removed = await client.query<{ id: string; evidence_id: string }>(
    `SELECT o.id, v.evidence_id FROM public.capture_evidence_observation o
     JOIN public.media_version v ON v.id=o.evidence_version_id
     WHERE o.id = ANY($1::uuid[]) AND ${versionRemovedSql('v')}`,
    [read],
  )
  if (!removed.rowCount) {
    return payload
  }
  const evidenceOf = new Map(removed.rows.map((row) => [row.id, row.evidence_id]))
  const told = new Set<string>()
  const changes = revision.changes!.flatMap((change): RevisionChangeDto[] => {
    const gone = observationsOf(change).flatMap((id) => {
      const evidenceId = evidenceOf.get(id)
      return evidenceId === undefined ? [] : [evidenceId]
    })
    if (!gone.length) {
      return [change]
    }
    return [...new Set(gone)]
      .filter((evidenceId) => !told.has(evidenceId))
      .map((evidenceId) => {
        told.add(evidenceId)
        return { kind: 'evidence' as const, evidence_id: evidenceId, removed: true as const }
      })
  })
  return { ...revision, changes }
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
          deliverableInboxItem(),
        ),
      ),
  )
  return Number(rows[0]?.pending ?? 0)
}

/**
 * Moves the cursor forward to `upTo`, never past the newest item and never backwards, and logs the
 * interval it acknowledged so each item keeps the time it was read. Returns whether it moved.
 */
export async function acknowledgeSessionInbox(client: PoolClient, lineageId: string, upTo: bigint) {
  const db = queryDatabase(client)
  const newest = await executeDatabaseQuery(
    db
      .select({ seq: agentSessionInbox.seq })
      .from(agentSessionInbox)
      .where(eq(agentSessionInbox.sessionLineageId, lineageId))
      .orderBy(desc(agentSessionInbox.seq))
      .limit(1),
  )
  const newestSeq = newest[0]?.seq ?? 0n
  const acknowledge = upTo < newestSeq ? upTo : newestSeq
  // Locked, so two advances cannot log overlapping intervals.
  const previousRows = await executeDatabaseQuery(
    db
      .select({ ackedSeq: agentSessionCursors.ackedSeq })
      .from(agentSessionCursors)
      .where(eq(agentSessionCursors.sessionLineageId, lineageId))
      .for('update'),
  )
  const previous = previousRows[0]?.ackedSeq ?? 0n
  if (acknowledge <= previous) {
    return false
  }
  const ackedAt = new Date()
  await executeDatabaseQuery(
    db
      .insert(agentSessionCursors)
      .values({ sessionLineageId: lineageId, ackedSeq: acknowledge, ackedAt })
      .onConflictDoUpdate({
        target: agentSessionCursors.sessionLineageId,
        set: { ackedSeq: acknowledge, ackedAt },
      }),
  )
  await executeDatabaseQuery(
    db.insert(agentSessionAcks).values({
      sessionLineageId: lineageId,
      fromSeq: previous,
      toSeq: acknowledge,
      ackedAt,
    }),
  )
  return true
}

/**
 * Acknowledges up to `afterSeq`, then returns the next unacknowledged items with their stable
 * IDs, so a lost response redelivers, and whether the cursor moved, so open readers can be told.
 * The caller holds the batch's share lock (`lockInboxBatch`), as the items returned are given.
 */
export async function readSessionInbox(client: PoolClient, lineageId: string, afterSeq: bigint) {
  const db = queryDatabase(client)
  const advanced = await acknowledgeSessionInbox(client, lineageId, afterSeq)
  const acked = await ackedSeq(client, lineageId)
  const rows = await executeDatabaseQuery(
    db
      .select()
      .from(agentSessionInbox)
      .where(
        and(
          eq(agentSessionInbox.sessionLineageId, lineageId),
          gt(agentSessionInbox.seq, acked),
          deliverableInboxItem(),
        ),
      )
      .orderBy(asc(agentSessionInbox.seq))
      .limit(INBOX_READ_LIMIT),
  )
  await releaseInboxItems(
    client,
    rows.map((row) => row.id),
  )
  const items: SessionInboxItemDto[] = []
  for (const row of rows) {
    items.push({
      id: row.id,
      seq: row.seq.toString(),
      kind: row.kind,
      payload: await deliverablePayload(client, row.kind, row.payload),
      created_at: row.createdAt.toISOString(),
    } as SessionInboxItemDto)
  }
  return { items, advanced }
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
