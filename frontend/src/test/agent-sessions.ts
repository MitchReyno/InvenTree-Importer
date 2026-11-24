import type { AgentSessionDto, AgentSessionListDto } from '@invimport/contracts'

/** Fixed identities for session list fixtures, valid under the contract's ID patterns. */
export const S = {
  batch: (n: number) => `40000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`,
  job: (n: number) => `50000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`,
  attempt: (n: number) => `60000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`,
  lot: (n: number) => `70000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`,
  failure: (n: number) => `80000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`,
}

const AT = '2026-11-06T01:00:00.000Z'

/** One session row: a queued Research session with no earlier attempts. */
export function sessionRow(partial: Partial<AgentSessionDto> = {}): AgentSessionDto {
  return {
    attempt_id: S.attempt(1),
    batch_id: S.batch(1),
    job_id: S.job(1),
    subject_id: S.lot(1),
    stage: 'research',
    state: 'queued',
    latest_on_job: true,
    attempt_number: 1,
    selection: { provider: 'codex', authentication: 'subscription', model: 'chosen-model' },
    settings_revision: '1',
    queued_at: AT,
    started_at: null,
    finished_at: null,
    state_since: AT,
    native_session_id: null,
    actual_model: null,
    progress: 'queued',
    occupies_lane: false,
    session_state: 'queued',
    latest_status: null,
    archived: false,
    runs_on: 'agent_vm',
    web: { public_pages: true, prefer_datasheets: true },
    start_fresh: { allowed: false, reason: 'session_not_replaceable' },
    earlier_attempts: [],
    earlier_attempt_count: 0,
    ...partial,
  }
}

/** A list read with nothing in it, overridden as a test needs. */
export function sessionList(partial: Partial<AgentSessionListDto> = {}): AgentSessionListDto {
  return {
    sessions: [],
    filter: 'all',
    counts: { needs_attention: 0, working: 0, waiting: 0, queued: 0, done_today: 0, all: 0 },
    totals: { slots_in_use: 0, queued: 0, waiting: 0 },
    batches: [],
    next_before: null,
    sessions_supported: true,
    ...partial,
  }
}
