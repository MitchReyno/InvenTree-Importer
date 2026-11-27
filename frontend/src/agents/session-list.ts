import type {
  AgentSessionDto,
  AgentSessionFilter,
  AgentSessionListDto,
  AgentSessionQueryDto,
  ProcessingStateDto,
  SessionFailureSummaryDto,
  SessionStateDto,
} from '@invimport/contracts'
import { failureCauseText } from '@invimport/contracts'
import { serverQueryKey, type ServerScope } from '#/queries/scope'

/** One attempt before a session's current one, from the session list or the history metadata. */
export type EarlierAttempt = {
  id: string
  number: number
  state: ProcessingStateDto
  sessionState: SessionStateDto | null
  /** When it ended, else when it was queued. */
  at: string
  failure?: SessionFailureSummaryDto
}

/** A list row's earlier attempts, newest first. */
export function earlierFromList(session: AgentSessionDto): EarlierAttempt[] {
  return session.earlier_attempts.map((attempt) => ({
    id: attempt.attempt_id,
    number: attempt.number,
    state: attempt.state,
    sessionState: attempt.session_state,
    at: attempt.ended_at ?? attempt.queued_at,
    failure: attempt.failure,
  }))
}

export type SessionListRead = (query?: AgentSessionQueryDto) => Promise<AgentSessionListDto>

/** The browser's local day as two instants, so the server dates Done today by the operator's day. */
export function localDayBounds(now: Date): Pick<AgentSessionQueryDto, 'day_start' | 'day_end'> {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  return { day_start: start.toISOString(), day_end: end.toISOString() }
}

/** Every reader of one query shares its cache entry; a live hint invalidates them all. */
export function sessionListKey(scope: ServerScope, query: AgentSessionQueryDto) {
  return serverQueryKey(
    scope,
    'agent-sessions',
    query.filter ?? 'all',
    query.batch_id ?? 'every-batch',
    query.day_start ?? 'no-day',
    query.before ?? 'newest',
  )
}

export const FILTER_LABELS: Record<AgentSessionFilter, string> = {
  needs_attention: 'Needs attention',
  working: 'Working',
  waiting: 'Waiting for you',
  queued: 'Queued',
  done_today: 'Done today',
  all: 'All',
}

/** What a collapsed batch says it has none of. */
export const NOTHING_MATCHES: Record<AgentSessionFilter, string> = {
  needs_attention: 'nothing needs attention',
  working: 'nothing working',
  waiting: 'nothing waiting for you',
  queued: 'nothing queued',
  done_today: 'nothing done today',
  all: 'no sessions',
}

/** Session states that need a fresh conversation to go on. */
export const NEEDS_RECOVERY = new Set([
  'failed',
  'interrupted',
  'resume_unavailable',
  'waiting_for_login',
])

/** Whether a session's current attempt failed or stopped in a way that offers recovery. */
export function needsRecovery(session: Pick<AgentSessionDto, 'state' | 'session_state'>) {
  return NEEDS_RECOVERY.has(session.session_state ?? session.state)
}

/** A failure's headline: its recorded cause in plain words, or that none was recorded. */
export function failureHeadline(failure: SessionFailureSummaryDto | undefined) {
  if (failure?.cause) {
    return failureCauseText(failure.cause)
  }
  return 'Failed · the cause wasn’t recorded'
}

/**
 * Rows of every loaded page, in order, each job once: a job that moved to an earlier page
 * between reads keeps its first place.
 */
export function mergedRows(pages: readonly (AgentSessionListDto | undefined)[]) {
  const seen = new Set<string>()
  const rows: AgentSessionDto[] = []
  for (const page of pages) {
    for (const row of page?.sessions ?? []) {
      if (!seen.has(row.job_id)) {
        seen.add(row.job_id)
        rows.push(row)
      }
    }
  }
  return rows
}

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

/** "2 earlier attempts failed", or "ended" when not every one of them failed. */
export function earlierAttemptsLabel(count: number, allFailed: boolean) {
  return `${plural(count, 'earlier attempt')} ${allFailed ? 'failed' : 'ended'}`
}

export { plural }
