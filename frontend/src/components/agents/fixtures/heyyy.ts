import type {
  AgentSessionDto,
  AgentSessionFilter,
  AgentSessionListDto,
  AgentSessionQueryDto,
  SessionFailureSummaryDto,
} from '@invimport/contracts'
import { S, sessionList, sessionRow } from '#/test/agent-sessions'

/**
 * Owned browser fixture: batch Heyyy's eight attempts across three sessions, five of them failed
 * retries, beside two batches whose Examine session was stopped. No API traffic.
 */
export const HEYYY = S.batch(11)
export const TEST123 = S.batch(12)
export const HEY = S.batch(13)

export const HEYYY_LOT = S.lot(11)

const today = (hour: number, minute: number) => {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute).toISOString()
}

const yesterday = (hour: number, minute: number) => {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, hour, minute).toISOString()
}

const configuration = (n: number, at: string): SessionFailureSummaryDto => ({
  id: S.failure(n),
  category: 'configuration',
  summary: 'The native session configuration was not accepted.',
  recovery: 'Check the supported CLI version and configuration, then start a fresh session.',
  details_available: false,
  failed_at: at,
  cause: { code: 'agent_admission_unavailable', provider: 'claude' },
})

const overloaded = (n: number, at: string): SessionFailureSummaryDto => ({
  id: S.failure(n),
  category: 'provider_network',
  summary: 'The provider connection or protocol failed.',
  recovery:
    'Claude was busy or unreachable. Start a fresh session when it’s back; nothing it published is lost.',
  details_available: false,
  failed_at: at,
  cause: {
    code: 'agent_turn_failed',
    provider: 'claude',
    provider_error: { kind: 'overloaded', result: null, http_status: 529 },
  },
  last_status: { text: 'Reading the batch and fetching photos', at },
})

const toolRefused = (n: number, at: string): SessionFailureSummaryDto => ({
  id: S.failure(n),
  category: 'tool_policy',
  summary: 'The provider attempted an operation outside the allowed tool policy.',
  recovery: 'Keep this conversation stopped and start a fresh session after correcting it.',
  details_available: false,
  failed_at: at,
  cause: { code: 'agent_tool_refused', provider: 'claude' },
  last_status: { text: 'Fetching a page on a private address', at },
})

function earlier(n: number, number: number, at: string, failure: SessionFailureSummaryDto) {
  return {
    attempt_id: S.attempt(n),
    number,
    state: 'superseded' as const,
    session_state: 'failed' as const,
    queued_at: at,
    ended_at: at,
    failure,
  }
}

function done(n: number, partial: Partial<AgentSessionDto>): AgentSessionDto {
  return sessionRow({
    attempt_id: S.attempt(n),
    job_id: S.job(n),
    batch_id: HEYYY,
    subject_id: HEYYY_LOT,
    state: 'ready',
    session_state: 'finished',
    progress: 'settled',
    ...partial,
  })
}

const rows: AgentSessionDto[] = [
  done(1, {
    stage: 'research',
    attempt_number: 3,
    state_since: today(13, 35),
    latest_status: { text: 'Proposed an identity · no public datasheet found', at: today(13, 35) },
    earlier_attempt_count: 2,
    earlier_attempts: [
      earlier(101, 2, today(13, 29), configuration(1, today(13, 29))),
      earlier(102, 1, today(10, 28), configuration(2, today(10, 28))),
    ],
  }),
  done(2, {
    stage: 'images',
    attempt_number: 2,
    state_since: today(13, 30),
    latest_status: { text: 'Proposed images · quantity 25, estimated', at: today(13, 30) },
    earlier_attempt_count: 1,
    earlier_attempts: [earlier(103, 1, today(13, 26), overloaded(3, today(13, 26)))],
  }),
  done(3, {
    stage: 'examine',
    subject_id: null,
    attempt_number: 3,
    state_since: today(13, 28),
    latest_status: { text: 'Formed 1 lot · stable', at: today(13, 28) },
    earlier_attempt_count: 2,
    earlier_attempts: [
      earlier(104, 2, today(13, 27), overloaded(4, today(13, 27))),
      earlier(105, 1, today(8, 17), overloaded(5, today(8, 17))),
    ],
  }),
  sessionRow({
    attempt_id: S.attempt(6),
    job_id: S.job(6),
    batch_id: TEST123,
    stage: 'examine',
    subject_id: null,
    state: 'failed',
    session_state: 'failed',
    state_since: yesterday(14, 30),
    failure: toolRefused(6, yesterday(14, 30)),
    start_fresh: { allowed: true },
  }),
  sessionRow({
    attempt_id: S.attempt(7),
    job_id: S.job(7),
    batch_id: HEY,
    stage: 'examine',
    subject_id: null,
    state: 'failed',
    session_state: 'failed',
    state_since: yesterday(0, 11),
    failure: toolRefused(7, yesterday(0, 11)),
    start_fresh: { allowed: true },
  }),
]

const NEEDS_ATTENTION = new Set(['failed', 'interrupted', 'waiting_for_login', 'waiting_for_user'])

/** The server's chip rules, applied to this fixture's few rows. */
function matches(row: AgentSessionDto, filter: AgentSessionFilter) {
  switch (filter) {
    case 'needs_attention':
      return NEEDS_ATTENTION.has(row.state)
    case 'working':
      return row.state === 'running'
    case 'waiting':
      return row.state === 'waiting_for_user'
    case 'queued':
      return row.state === 'queued'
    case 'done_today':
      return row.state === 'ready' && row.state_since >= today(0, 0)
    case 'all':
      return true
  }
}

const count = (filter: AgentSessionFilter) => rows.filter((row) => matches(row, filter)).length

/** One read of the fixture list, filtered and scoped as the server would. */
export async function heyyySessions(
  query: AgentSessionQueryDto = {},
): Promise<AgentSessionListDto> {
  const filter = query.filter ?? 'all'
  const scoped = rows.filter((row) => !query.batch_id || row.batch_id === query.batch_id)
  const batchIds = [...new Set(scoped.map((row) => row.batch_id))]
  return sessionList({
    filter,
    sessions: scoped.filter((row) => matches(row, filter)),
    counts: {
      needs_attention: count('needs_attention'),
      working: count('working'),
      waiting: count('waiting'),
      queued: count('queued'),
      done_today: count('done_today'),
      all: count('all'),
    },
    totals: { slots_in_use: 0, queued: 0, waiting: 0 },
    batches: batchIds.map((batchId) => {
      const own = scoped.filter((row) => row.batch_id === batchId)
      return {
        batch_id: batchId,
        archived: false,
        sessions: own.length,
        matching: own.filter((row) => matches(row, filter)).length,
        first_started_at: today(8, 0),
      }
    }),
  })
}

export const HEYYY_NAMES: Record<string, string> = {
  [HEYYY]: 'Heyyy',
  [TEST123]: 'Test123',
  [HEY]: 'Hey',
}
