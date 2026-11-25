import type { Pool, PoolClient } from 'pg'
import {
  SESSION_HISTORY_PAGE_SIZE,
  validate,
  type ProcessingStateDto,
  type SessionHistoryAttemptDto,
  type SessionHistoryDto,
  type SessionInboxItemDto,
  type SessionOutboxItemDto,
  type SessionStateDto,
} from '@invimport/contracts'
import { transaction } from '#/db/database.ts'
import { captureInTransaction } from '#/capture/repository.ts'
import type { ProcessingConfig } from '#/processing/attempts.ts'
import { fail } from '#/processing/model.ts'
import { HAS_SESSION_HISTORY } from '#/processing/session-history-job.ts'
import { decodeJobInput, isSessionInput } from '#/processing/session-input.ts'
import { webAccess } from '#/processing/session-policy.ts'
import { latestSessionFailures } from '#/agents/failures.ts'
import { startFreshEligibility } from '#/processing/start-fresh-eligibility.ts'
import { resolveHistoryEntries, type HistoryRow, type HistoryJob } from './history-entries.ts'

/** Inbox rows sort as if their attempt were this, below every real attempt ID. */
const INBOX_ORDER_ATTEMPT = '00000000-0000-0000-0000-000000000000'
const INBOX_STREAM = 0
const OUTBOX_STREAM = 1
const ENDED_STATES: readonly ProcessingStateDto[] = [
  'ready',
  'failed',
  'cancelled',
  'superseded',
  'interrupted',
]
const FAILED_STATES: readonly ProcessingStateDto[] = ['failed', 'interrupted']

/** A row's place in the history's one total order: time, then stream, attempt and sequence. */
interface HistoryPosition {
  at: string
  stream: typeof INBOX_STREAM | typeof OUTBOX_STREAM
  attemptId: string
  seq: string
}

export function encodeHistoryCursor(position: HistoryPosition) {
  const fields = [position.at, position.stream, position.attemptId, position.seq]
  return Buffer.from(JSON.stringify(fields), 'utf8').toString('base64url')
}

const ISO_MILLISECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const SEQUENCE = /^[1-9][0-9]{0,18}$/

/** Refuses anything this read did not issue, rather than guessing a position from it. */
export function decodeHistoryCursor(value: string): HistoryPosition {
  let fields: unknown
  try {
    fields = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
  } catch {
    return fail('invalid_history_cursor', 400)
  }
  if (!Array.isArray(fields) || fields.length !== 4) {
    return fail('invalid_history_cursor', 400)
  }
  const [at, stream, attemptId, seq] = fields as unknown[]
  // Round-tripping refuses dates JavaScript would normalise, such as 30 February; PostgreSQL
  // has no year 0.
  const validTime =
    typeof at === 'string' &&
    ISO_MILLISECONDS.test(at) &&
    !at.startsWith('0000-') &&
    !Number.isNaN(Date.parse(at)) &&
    new Date(at).toISOString() === at
  const validStream = stream === INBOX_STREAM || stream === OUTBOX_STREAM
  const validAttempt = typeof attemptId === 'string' && UUID.test(attemptId)
  const validSeq =
    typeof seq === 'string' && SEQUENCE.test(seq) && BigInt(seq) <= 9223372036854775807n
  if (!validTime || !validStream || !validAttempt || !validSeq) {
    return fail('invalid_history_cursor', 400)
  }
  return { at, stream, attemptId, seq }
}

/**
 * The job, if it is in this batch of the caller's account and holds a session attempt of that
 * account. Its current attempt may not be a session after a switch to another profile.
 */
async function scopedSessionJob(
  client: PoolClient,
  config: ProcessingConfig,
  batchId: string,
  jobId: string,
): Promise<HistoryJob> {
  const rows = await client.query<{
    id: string
    batch_id: string
    stage: HistoryJob['stage']
    subject_id: string | null
    current_attempt_id: string
  }>(
    `SELECT j.id, j.batch_id, j.stage, j.subject_id, j.current_attempt_id
       FROM public.processing_job j
       JOIN public.capture_batch b ON b.id=j.batch_id
      WHERE j.id=$1 AND j.batch_id=$2
        AND b.actor_id=$3 AND b.target_id=$4 AND b.target_context_id=$5
        AND ${HAS_SESSION_HISTORY}`,
    [jobId, batchId, config.actorId, config.targetId, config.targetContextId],
  )
  const job = rows.rows[0] ?? fail('session_not_found', 404)
  return {
    id: job.id,
    batchId: job.batch_id,
    stage: job.stage,
    subjectId: job.subject_id,
    currentAttemptId: job.current_attempt_id,
  }
}

/** Where an attempt's profile runs it: the paired agent VM, the host, or the fixture. */
export function runsOn(profileId: string): SessionHistoryAttemptDto['runs_on'] {
  if (profileId === 'synthetic-session/1') {
    return 'fixture'
  }
  return profileId.startsWith('shared-vm-agent/') ? 'agent_vm' : 'host'
}

/**
 * Every attempt's header, newest first. An attempt's span runs from its queue time; its end is
 * its latest transition, by retained order, while that is into its current terminal state, since
 * a turn's `finished_at` is not an attempt's end and idle cancellation or supersession writes none.
 * Every read returns them all, so no older page loses its headers; a lineage grows only by a
 * restart, retry or Start fresh.
 */
async function historyAttempts(client: PoolClient, job: HistoryJob) {
  const rows = await client.query<{
    id: string
    number: string
    state: ProcessingStateDto
    profile_id: string
    session_state: SessionStateDto | null
    queued_at: Date
    actual_model: string | null
    manifest_bytes: Buffer
    manifest_digest: Buffer
    last_state: ProcessingStateDto | null
    last_state_at: Date | null
    settled_state: ProcessingStateDto | null
    last_activity_at: Date | null
  }>(
    `SELECT a.id, a.number::text, a.state, a.profile_id, s.session_state, s.queued_at,
            s.actual_model, i.manifest_bytes, i.manifest_digest,
            latest.state AS last_state, latest.created_at AS last_state_at,
            (SELECT t.state FROM public.processing_transition t
              WHERE t.attempt_id=a.id AND t.state<>'superseded'
              ORDER BY t.sequence DESC LIMIT 1) AS settled_state,
            GREATEST(s.finished_at,
              (SELECT max(o.created_at) FROM public.agent_session_outbox o
                WHERE o.session_id=a.id)) AS last_activity_at
       FROM public.processing_attempt a
       JOIN public.agent_session s ON s.attempt_id=a.id
       JOIN public.processing_input i ON i.id=a.input_id
       LEFT JOIN LATERAL (
         SELECT t.state, t.created_at FROM public.processing_transition t
          WHERE t.attempt_id=a.id ORDER BY t.sequence DESC LIMIT 1
       ) latest ON true
      WHERE a.job_id=$1 AND s.session_lineage_id=$1
      ORDER BY a.number DESC`,
    [job.id],
  )
  const failures = await latestSessionFailures(
    client,
    rows.rows.map((row) => row.id),
  )
  // Start fresh supersedes a failed or interrupted attempt, so its state before that counts.
  const settledOfNumber = new Map(rows.rows.map((row) => [row.number, row.settled_state]))
  return rows.rows.map((row): SessionHistoryAttemptDto => {
    const manifest = decodeJobInput(row.manifest_bytes, row.manifest_digest)
    if (!isSessionInput(manifest)) {
      return fail('agent_session_binding_invalid', 503)
    }
    const number = Number(row.number)
    const previous = settledOfNumber.get((BigInt(row.number) - 1n).toString()) ?? undefined
    const failure = failures.get(row.id)
    return {
      id: row.id,
      number,
      state: row.state,
      session_state: row.session_state,
      queued_at: row.queued_at.toISOString(),
      ...attemptEnd(row),
      started_because: startedBecause(number, previous),
      profile_id: row.profile_id,
      runs_on: runsOn(row.profile_id),
      selection: manifest.agent,
      actual_model: row.actual_model,
      web: sealedWeb(row.profile_id, manifest),
      ...(failure ? { failure } : {}),
    }
  })
}

/** The web setting sealed in an attempt's input; null when its profile has no web access. */
export function sealedWeb(
  profileId: string,
  manifest: { web?: SessionHistoryAttemptDto['web'] },
): SessionHistoryAttemptDto['web'] {
  return webAccess(profileId) === 'available' ? (manifest.web ?? null) : null
}

function attemptEnd(row: {
  state: ProcessingStateDto
  last_state: ProcessingStateDto | null
  last_state_at: Date | null
  last_activity_at: Date | null
}): Pick<SessionHistoryAttemptDto, 'ended'> {
  if (!ENDED_STATES.includes(row.state)) {
    return {}
  }
  if (row.last_state === row.state && row.last_state_at) {
    return { ended: { at: row.last_state_at.toISOString(), source: 'transition' } }
  }
  if (row.last_activity_at) {
    return { ended: { at: row.last_activity_at.toISOString(), source: 'last_activity' } }
  }
  return {}
}

/** Attempts record no reason for starting; only the first and a retry after a failure show. */
function startedBecause(
  number: number,
  previous: ProcessingStateDto | undefined,
): SessionHistoryAttemptDto['started_because'] {
  if (number === 1) {
    return 'first'
  }
  return previous && FAILED_STATES.includes(previous) ? 'after_failure' : null
}

async function inboxCursor(client: PoolClient, jobId: string) {
  const rows = await client.query<{ acked_seq: string }>(
    'SELECT acked_seq::text FROM public.agent_session_cursor WHERE session_lineage_id=$1',
    [jobId],
  )
  return BigInt(rows.rows[0]?.acked_seq ?? '0')
}

/** One page of stored rows, newest first, from both streams in the history's total order. */
async function historyRows(client: PoolClient, jobId: string, before?: HistoryPosition) {
  const rows = await client.query<{
    stream: number
    attempt_id: string | null
    attempt_number: string | null
    seq: string
    kind: string
    payload: unknown
    created_at: Date
    item_id: string | null
    actor_id: string | null
    idempotency_key: string | null
  }>(
    `SELECT h.stream, h.attempt_id, h.attempt_number, h.seq::text, h.kind, h.payload,
            h.created_at, h.item_id, h.actor_id, h.idempotency_key
       FROM (
         SELECT ${OUTBOX_STREAM} AS stream, o.session_id AS attempt_id,
                o.session_id AS order_attempt, a.number::text AS attempt_number, o.seq, o.kind,
                o.payload, o.created_at, NULL::uuid AS item_id, NULL::uuid AS actor_id,
                NULL::text AS idempotency_key
           FROM public.agent_session_outbox o
           JOIN public.agent_session s ON s.attempt_id=o.session_id
           JOIN public.processing_attempt a ON a.id=o.session_id
          WHERE s.session_lineage_id=$1 AND a.job_id=$1
         UNION ALL
         SELECT ${INBOX_STREAM}, NULL, '${INBOX_ORDER_ATTEMPT}'::uuid, NULL, i.seq, i.kind,
                i.payload, i.created_at, i.id, i.actor_id, i.idempotency_key
           FROM public.agent_session_inbox i
          WHERE i.session_lineage_id=$1
            -- A withdrawn item was never given to the session, so it isn't in its history.
            AND NOT EXISTS (SELECT 1 FROM public.agent_session_inbox_withdrawal w WHERE w.item_id=i.id)
       ) h
      WHERE $2::timestamptz IS NULL
         OR (h.created_at, h.stream, h.order_attempt, h.seq)
            < ($2::timestamptz, $3::integer, $4::uuid, $5::bigint)
      ORDER BY h.created_at DESC, h.stream DESC, h.order_attempt DESC, h.seq DESC
      LIMIT $6`,
    [
      jobId,
      before?.at ?? null,
      before?.stream ?? null,
      before?.attemptId ?? null,
      before?.seq ?? null,
      SESSION_HISTORY_PAGE_SIZE + 1,
    ],
  )
  return rows.rows.map((row): HistoryRow => {
    const createdAt = row.created_at.toISOString()
    if (row.stream === OUTBOX_STREAM) {
      const item = {
        session_id: row.attempt_id!,
        seq: row.seq,
        kind: row.kind,
        payload: row.payload,
        created_at: createdAt,
      }
      validate('SessionOutboxItem', item)
      return {
        stream: 'outbox',
        item: item as SessionOutboxItemDto,
        attemptNumber: Number(row.attempt_number),
      }
    }
    const item = {
      id: row.item_id!,
      seq: row.seq,
      kind: row.kind,
      payload: row.payload,
      created_at: createdAt,
    }
    validate('SessionInboxItem', item)
    return {
      stream: 'inbox',
      item: item as SessionInboxItemDto,
      actorId: row.actor_id,
      idempotencyKey: row.idempotency_key!,
    }
  })
}

function positionOf(row: HistoryRow): HistoryPosition {
  if (row.stream === 'outbox') {
    return {
      at: row.item.created_at,
      stream: OUTBOX_STREAM,
      attemptId: row.item.session_id,
      seq: row.item.seq,
    }
  }
  return {
    at: row.item.created_at,
    stream: INBOX_STREAM,
    attemptId: INBOX_ORDER_ATTEMPT,
    seq: row.item.seq,
  }
}

/**
 * A job's session history: the newest page without `before`, the next older page with it. The
 * page, its cursor and the session metadata come from one repeatable-read snapshot, scoped to
 * the batch and the caller's account.
 */
export async function readSessionHistory(
  pool: Pool,
  config: ProcessingConfig,
  batchId: string,
  jobId: string,
  options: { before?: string } = {},
): Promise<SessionHistoryDto> {
  const before = options.before === undefined ? undefined : decodeHistoryCursor(options.before)
  return transaction(pool, async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const job = await scopedSessionJob(client, config, batchId, jobId)
    const { snapshot } = await captureInTransaction(client, config, batchId)
    const attempts = await historyAttempts(client, job)
    const eligibility = await startFreshEligibility(client, config, [job.id], {
      captures: new Map([[batchId, snapshot]]),
    })
    const ackedSeq = await inboxCursor(client, jobId)
    const rows = await historyRows(client, jobId, before)
    const page = rows.slice(0, SESSION_HISTORY_PAGE_SIZE)
    const entries = await resolveHistoryEntries(client, { job, capture: snapshot, ackedSeq }, page)
    const oldest = page.at(-1)
    const history: SessionHistoryDto = {
      session: {
        job_id: job.id,
        batch_id: job.batchId,
        stage: job.stage,
        subject_id: job.subjectId,
        current_attempt_id: job.currentAttemptId,
        attempts,
        inbox_acked_seq: ackedSeq.toString(),
        start_fresh: eligibility.get(job.id)!,
      },
      entries,
      ...(rows.length > SESSION_HISTORY_PAGE_SIZE && oldest
        ? { before: encodeHistoryCursor(positionOf(oldest)) }
        : {}),
    }
    validate('SessionHistory', history)
    return history
  })
}
