import type { Pool, PoolClient } from 'pg'
import { and, eq } from 'drizzle-orm'
import {
  MAX_EARLIER_ATTEMPTS,
  type AgentSessionDto,
  type AgentSessionEarlierAttemptDto,
  type AgentSessionFilter,
  type AgentSessionListDto,
  type AgentSessionQueryDto,
  type ProcessingStageV2Dto,
  type ProcessingStateDto,
  type SessionStateDto,
} from '@invimport/contracts'
import { executeDatabaseQuery, queryDatabase, transaction } from '#/db/database.ts'
import { commands } from '#/db/schema.ts'
import { appendEvent } from '#/db/authority.ts'
import { processingAttempts } from '#/processing/schema.ts'
import { captureInTransaction } from '#/capture/repository.ts'
import type { ProcessingConfig } from '#/processing/attempts.ts'
import { fail, mediaProfileId } from '#/processing/model.ts'
import { decodeJobInput } from '#/processing/session-input.ts'
import { startFreshEligibility } from '#/processing/start-fresh-eligibility.ts'
import { latestStatuses } from '#/agents/tools/outbox.ts'
import { runsOn, sealedWeb } from '#/agents/tools/history.ts'
import { latestSessionFailures } from '#/agents/failures.ts'
import { agentSessions } from '#/agents/schema.ts'
import { isSessionProfile } from '#/processing/session-policy.ts'
import { pausedAmong, pausedBatchIds } from '#/agents/pause.ts'

const SESSION_PAGE_SIZE = 50
const BATCH_SUMMARY_LIMIT = 200
const ENDED_STATES: readonly ProcessingStateDto[] = [
  'ready',
  'failed',
  'cancelled',
  'superseded',
  'interrupted',
]

/** Whether the configured profile runs agent sessions at all. */
export function sessionsSupported(config: Pick<ProcessingConfig, 'profileId'>) {
  return isSessionProfile(config.profileId ?? mediaProfileId)
}

interface SessionCursor {
  queuedAt: string
  jobId: string
}

const ISO_MILLISECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function encodeSessionCursor(cursor: SessionCursor) {
  return Buffer.from(JSON.stringify([cursor.queuedAt, cursor.jobId]), 'utf8').toString('base64url')
}

/** Refuses anything this list did not issue, rather than guessing a position from it. */
export function decodeSessionCursor(value: string): SessionCursor {
  let fields: unknown
  try {
    fields = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
  } catch {
    return fail('invalid_session_cursor', 400)
  }
  if (!Array.isArray(fields) || fields.length !== 2) {
    return fail('invalid_session_cursor', 400)
  }
  const [queuedAt, jobId] = fields as unknown[]
  const validTime =
    typeof queuedAt === 'string' &&
    ISO_MILLISECONDS.test(queuedAt) &&
    !Number.isNaN(Date.parse(queuedAt)) &&
    new Date(queuedAt).toISOString() === queuedAt
  const validJob = typeof jobId === 'string' && UUID.test(jobId)
  if (!validTime || !validJob) {
    return fail('invalid_session_cursor', 400)
  }
  return { queuedAt, jobId }
}

/** The browser's local day, as two instants; Done today needs both, in order. */
function dayBounds(query: AgentSessionQueryDto) {
  const given = [query.day_start, query.day_end].filter((bound) => bound !== undefined)
  if (given.length === 0) {
    return null
  }
  const start = Date.parse(query.day_start ?? '')
  const end = Date.parse(query.day_end ?? '')
  if (given.length !== 2 || Number.isNaN(start) || Number.isNaN(end) || start >= end) {
    return fail('invalid_session_query', 400)
  }
  return { start: new Date(start), end: new Date(end) }
}

/**
 * One row per job in the caller's account, its newest session attempt first, with each chip's
 * rule as a column. Parameters: $1–$3 the account, $4 the batch or null, $5–$6 the day bounds or
 * null, $7 the filter. Done today ends by the attempt's latest transition, never `finished_at`.
 */
const CLASSIFIED_SESSIONS = `
  WITH scoped AS (
    SELECT a.id AS attempt_id, a.job_id, a.batch_id, a.number, a.state, a.profile_id, a.input_id,
           s.queued_at
      FROM public.processing_attempt a
      JOIN public.agent_session s ON s.attempt_id=a.id
      JOIN public.command c ON c.id=a.command_id
     WHERE c.actor_id=$1 AND c.target_id=$2 AND c.target_context_id=$3
       AND ($4::uuid IS NULL OR a.batch_id=$4::uuid)
  ),
  newest AS (
    SELECT DISTINCT ON (scoped.job_id) scoped.*, b.archived,
           latest.state AS last_state, latest.created_at AS last_at
      FROM scoped
      JOIN public.capture_batch b ON b.id=scoped.batch_id
      LEFT JOIN LATERAL (
        SELECT t.state, t.created_at FROM public.processing_transition t
         WHERE t.attempt_id=scoped.attempt_id ORDER BY t.sequence DESC LIMIT 1
      ) latest ON true
     ORDER BY scoped.job_id, scoped.number DESC
  ),
  classified AS (
    SELECT newest.*,
           state IN ('failed','interrupted','waiting_for_login','waiting_for_user') AS needs_attention,
           state='running' AS working,
           state='waiting_for_user' AS waiting,
           state IN ('queued','waiting_for_capacity') AS queued,
           COALESCE(state = ANY($8::text[]) AND last_state=state
             AND last_at >= $5::timestamptz AND last_at < $6::timestamptz, false) AS done_today
      FROM newest
  ),
  matched AS (
    SELECT classified.*,
           ($7::text='all' OR NOT archived) AND CASE $7::text
             WHEN 'needs_attention' THEN needs_attention
             WHEN 'working' THEN working
             WHEN 'waiting' THEN waiting
             WHEN 'queued' THEN queued
             WHEN 'done_today' THEN done_today
             ELSE true
           END AS matches
      FROM classified
  )`

interface ListScope {
  config: ProcessingConfig
  batchId: string | null
  day: { start: Date; end: Date } | null
  filter: AgentSessionFilter
}

function scopeParameters(scope: ListScope) {
  return [
    scope.config.actorId,
    scope.config.targetId,
    scope.config.targetContextId,
    scope.batchId,
    scope.day?.start ?? null,
    scope.day?.end ?? null,
    scope.filter,
    ENDED_STATES,
  ]
}

interface PageRow {
  attempt_id: string
  job_id: string
  batch_id: string
  number: string
  state: ProcessingStateDto
  profile_id: string
  queued_at: Date
  archived: boolean
  last_state: ProcessingStateDto | null
  last_at: Date | null
  subject_id: string | null
  stage: ProcessingStageV2Dto
  current_attempt_id: string
  started_at: Date | null
  finished_at: Date | null
  native_session_id: string | null
  actual_model: string | null
  progress: AgentSessionDto['progress']
  session_state: SessionStateDto | null
  occupies_lane: boolean
  manifest_bytes: Buffer
  manifest_digest: Buffer
}

async function pageRows(client: PoolClient, scope: ListScope, cursor: SessionCursor | null) {
  const rows = await client.query<PageRow>(
    `${CLASSIFIED_SESSIONS}
     SELECT m.attempt_id, m.job_id, m.batch_id, m.number::text, m.state, m.profile_id, m.queued_at,
            m.archived, m.last_state, m.last_at, j.subject_id, j.stage, j.current_attempt_id,
            s.started_at, s.finished_at, s.native_session_id, s.actual_model, s.progress,
            s.session_state, i.manifest_bytes, i.manifest_digest,
            (EXISTS (SELECT 1 FROM public.agent_slot slot WHERE slot.attempt_id=m.attempt_id)
              OR EXISTS (SELECT 1 FROM public.processing_lane lane
                          WHERE lane.attempt_id=m.attempt_id)) AS occupies_lane
       FROM matched m
       JOIN public.processing_job j ON j.id=m.job_id
       JOIN public.agent_session s ON s.attempt_id=m.attempt_id
       JOIN public.processing_input i ON i.id=m.input_id
      WHERE m.matches
        AND ($9::timestamptz IS NULL OR (m.queued_at, m.job_id) < ($9::timestamptz, $10::uuid))
      ORDER BY m.queued_at DESC, m.job_id DESC
      LIMIT $11`,
    [
      ...scopeParameters(scope),
      cursor?.queuedAt ?? null,
      cursor?.jobId ?? null,
      SESSION_PAGE_SIZE + 1,
    ],
  )
  return rows.rows
}

/** Chip counts across the scope (archived only under All) and totals that ignore the filter. */
async function countSessions(client: PoolClient, scope: ListScope) {
  const counts = await client.query<Record<string, string>>(
    `${CLASSIFIED_SESSIONS}
     SELECT count(*) FILTER (WHERE needs_attention AND NOT archived)::text AS needs_attention,
            count(*) FILTER (WHERE working AND NOT archived)::text AS working,
            count(*) FILTER (WHERE waiting AND NOT archived)::text AS waiting,
            count(*) FILTER (WHERE queued AND NOT archived)::text AS queued,
            count(*) FILTER (WHERE done_today AND NOT archived)::text AS done_today,
            count(*)::text AS all,
            count(*) FILTER (WHERE queued)::text AS queued_total,
            count(*) FILTER (WHERE waiting)::text AS waiting_total,
            (SELECT count(*) FROM scoped
              WHERE EXISTS (SELECT 1 FROM public.agent_slot slot
                             WHERE slot.attempt_id=scoped.attempt_id)
                 OR EXISTS (SELECT 1 FROM public.processing_lane lane
                             WHERE lane.attempt_id=scoped.attempt_id))::text AS slots_in_use
       FROM matched`,
    scopeParameters(scope),
  )
  const row = counts.rows[0]

  const count = (name: string) => Number(row[name])

  return {
    counts: {
      needs_attention: count('needs_attention'),
      working: count('working'),
      waiting: count('waiting'),
      queued: count('queued'),
      ...(scope.day ? { done_today: count('done_today') } : {}),
      all: count('all'),
    },
    totals: {
      slots_in_use: count('slots_in_use'),
      queued: count('queued_total'),
      waiting: count('waiting_total'),
    },
  }
}

/** Every batch in scope, newest activity first; archived ones only under All. */
async function batchSummaries(client: PoolClient, scope: ListScope) {
  const rows = await client.query<{
    batch_id: string
    archived: boolean
    sessions: string
    matching: string
    first_started_at: Date | null
  }>(
    `${CLASSIFIED_SESSIONS}
     SELECT g.batch_id, g.archived, g.sessions::text, g.matching::text,
            (SELECT min(t.created_at) FROM public.processing_transition t
               JOIN scoped started ON started.attempt_id=t.attempt_id
              WHERE started.batch_id=g.batch_id AND t.state='running') AS first_started_at
       FROM (
         SELECT batch_id, archived, count(*) AS sessions,
                count(*) FILTER (WHERE matches) AS matching, max(queued_at) AS newest
           FROM matched
          WHERE $7::text='all' OR NOT archived
          GROUP BY batch_id, archived
       ) g
      ORDER BY g.newest DESC, g.batch_id DESC
      LIMIT $9`,
    [...scopeParameters(scope), BATCH_SUMMARY_LIMIT + 1],
  )
  const batches = rows.rows.slice(0, BATCH_SUMMARY_LIMIT).map((row) => ({
    batch_id: row.batch_id,
    archived: row.archived,
    sessions: Number(row.sessions),
    matching: Number(row.matching),
    first_started_at: row.first_started_at?.toISOString() ?? null,
  }))
  return { batches, truncated: rows.rows.length > BATCH_SUMMARY_LIMIT }
}

/** An ended attempt's latest transition into its current state; none while it is live. */
function endedAt(row: {
  state: ProcessingStateDto
  last_state: ProcessingStateDto | null
  last_at: Date | null
}) {
  const ended = ENDED_STATES.includes(row.state) && row.last_state === row.state && row.last_at
  return ended ? row.last_at!.toISOString() : undefined
}

/** Each page job's attempts before its row's, newest first and bounded, with how many there are. */
async function earlierAttempts(client: PoolClient, config: ProcessingConfig, rows: PageRow[]) {
  const earlier = new Map<string, { attempts: AgentSessionEarlierAttemptDto[]; count: number }>()
  for (const row of rows) {
    earlier.set(row.job_id, { attempts: [], count: 0 })
  }
  if (!rows.length) {
    return earlier
  }
  const result = await client.query<{
    attempt_id: string
    job_id: string
    number: string
    state: ProcessingStateDto
    session_state: SessionStateDto | null
    queued_at: Date
    last_state: ProcessingStateDto | null
    last_at: Date | null
    total: string
  }>(
    `SELECT e.* FROM (
       SELECT a.id AS attempt_id, a.job_id, a.number::text, a.state, s.session_state, s.queued_at,
              latest.state AS last_state, latest.created_at AS last_at,
              row_number() OVER (PARTITION BY a.job_id ORDER BY a.number DESC) AS position,
              (count(*) OVER (PARTITION BY a.job_id))::text AS total
         FROM unnest($1::uuid[], $2::bigint[]) AS page(job_id, number)
         JOIN public.processing_attempt a ON a.job_id=page.job_id AND a.number < page.number
         JOIN public.agent_session s ON s.attempt_id=a.id
         JOIN public.command c ON c.id=a.command_id
         LEFT JOIN LATERAL (
           SELECT t.state, t.created_at FROM public.processing_transition t
            WHERE t.attempt_id=a.id ORDER BY t.sequence DESC LIMIT 1
         ) latest ON true
        WHERE c.actor_id=$3 AND c.target_id=$4 AND c.target_context_id=$5
     ) e
     WHERE e.position <= $6
     ORDER BY e.job_id, e.number::bigint DESC`,
    [
      rows.map((row) => row.job_id),
      rows.map((row) => row.number),
      config.actorId,
      config.targetId,
      config.targetContextId,
      MAX_EARLIER_ATTEMPTS,
    ],
  )
  const failures = await latestSessionFailures(
    client,
    result.rows.map((row) => row.attempt_id),
  )
  for (const row of result.rows) {
    const job = earlier.get(row.job_id)!
    const ended = endedAt(row)
    const failure = failures.get(row.attempt_id)
    job.count = Number(row.total)
    job.attempts.push({
      attempt_id: row.attempt_id,
      number: Number(row.number),
      state: row.state,
      session_state: row.session_state,
      queued_at: row.queued_at.toISOString(),
      ...(ended ? { ended_at: ended } : {}),
      ...(failure ? { failure } : {}),
    })
  }
  return earlier
}

function listScope(config: ProcessingConfig, query: AgentSessionQueryDto): ListScope {
  const day = dayBounds(query)
  const filter = query.filter ?? 'all'
  if (filter === 'done_today' && !day) {
    fail('invalid_session_query', 400)
  }
  return { config, batchId: query.batch_id ?? null, day, filter }
}

/**
 * The Agents read: one row per session (job) in the caller's account, filtered before paging, with
 * scoped chip and batch counts and slot, queued and waiting totals that ignore the filter. Rows
 * carry their earlier attempts and whether Start fresh would be accepted now.
 */
export async function listAgentSessions(
  pool: Pool,
  binding: ProcessingConfig,
  query: AgentSessionQueryDto = {},
): Promise<AgentSessionListDto> {
  const scope = listScope(binding, query)
  const cursor = query.before === undefined ? null : decodeSessionCursor(query.before)
  return transaction(pool, async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const rows = await pageRows(client, scope, cursor)
    const page = rows.slice(0, SESSION_PAGE_SIZE)
    const attemptIds = page.map((row) => row.attempt_id)
    const { counts, totals } = await countSessions(client, scope)
    const summary = await batchSummaries(client, scope)
    const failures = await latestSessionFailures(client, attemptIds)
    const statuses = await latestStatuses(client, attemptIds)
    const earlier = await earlierAttempts(client, binding, page)
    const eligibility = await startFreshEligibility(
      client,
      binding,
      page.map((row) => row.job_id),
    )
    const paused = await pausedBatchIds(client, binding)
    const pausedSet = await pausedAmong(client, [...new Set(page.map((row) => row.batch_id))])
    const sessions = page.map((row) =>
      sessionRow(row, {
        failure: failures.get(row.attempt_id),
        status: statuses.get(row.attempt_id) ?? null,
        earlier: earlier.get(row.job_id)!,
        eligibility: eligibility.get(row.job_id)!,
        paused: pausedSet.has(row.batch_id),
      }),
    )
    const last = page.at(-1)
    return {
      sessions,
      filter: scope.filter,
      counts,
      totals,
      batches: summary.batches,
      ...(summary.truncated ? { batches_truncated: true as const } : {}),
      paused_batch_ids: paused.ids,
      ...(paused.truncated ? { paused_truncated: true as const } : {}),
      next_before:
        rows.length > SESSION_PAGE_SIZE && last
          ? encodeSessionCursor({ queuedAt: last.queued_at.toISOString(), jobId: last.job_id })
          : null,
      sessions_supported: sessionsSupported(binding),
    }
  })
}

function sessionRow(
  row: PageRow,
  facts: {
    failure: AgentSessionDto['failure']
    status: AgentSessionDto['latest_status']
    earlier: { attempts: AgentSessionEarlierAttemptDto[]; count: number }
    eligibility: AgentSessionDto['start_fresh']
    paused: boolean
  },
): AgentSessionDto {
  const manifest = decodeJobInput(row.manifest_bytes, row.manifest_digest)
  if (
    manifest.schema_version !== 'bench-intake-input/4' &&
    manifest.schema_version !== 'bench-intake-input/6'
  ) {
    fail('agent_session_binding_invalid', 503)
  }
  return {
    attempt_id: row.attempt_id,
    ...(facts.failure ? { failure: facts.failure } : {}),
    batch_id: row.batch_id,
    job_id: row.job_id,
    subject_id: row.subject_id,
    stage: row.stage,
    state: row.state,
    latest_on_job: row.current_attempt_id === row.attempt_id,
    attempt_number: Number(row.number),
    selection: manifest.agent,
    settings_revision: manifest.settings_revision,
    queued_at: row.queued_at.toISOString(),
    started_at: row.started_at?.toISOString() ?? null,
    finished_at: row.finished_at?.toISOString() ?? null,
    state_since: (row.last_at ?? row.queued_at).toISOString(),
    native_session_id: row.native_session_id,
    actual_model: row.actual_model,
    progress: row.progress,
    occupies_lane: row.occupies_lane,
    session_state: row.session_state,
    latest_status: facts.status,
    ...(facts.paused ? { paused: true as const } : {}),
    archived: row.archived,
    runs_on: runsOn(row.profile_id),
    web:
      manifest.schema_version === 'bench-intake-input/6'
        ? sealedWeb(row.profile_id, manifest)
        : null,
    start_fresh: facts.eligibility,
    earlier_attempts: facts.earlier.attempts,
    earlier_attempt_count: facts.earlier.count,
  }
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
