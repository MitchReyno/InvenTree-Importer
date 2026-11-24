import type { HeaderWorkDto } from '@invimport/contracts'
import { describe, expect, it } from 'vitest'
import { workSummary } from './workSummary'

type Work = HeaderWorkDto['work'][number]
type Session = HeaderWorkDto['active_sessions'][number]

const batch = 'b0000000-0000-4000-8000-000000000001'
const other = 'b0000000-0000-4000-8000-000000000002'

let next = 0

function id() {
  next += 1
  return `00000000-0000-4000-8000-${String(next).padStart(12, '0')}`
}

function job(stage: string, state: string, overrides: Partial<Work> = {}): Work {
  return {
    kind: 'processing',
    id: id(),
    batch_id: batch,
    attempt_id: id(),
    stage,
    state,
    input_current: true,
    occupies_lane: false,
    blocked_code: null,
    steps: [],
    steps_complete: true,
    ...overrides,
  } as Work
}

function session(stage: string, overrides: Partial<Session> = {}): Session {
  return {
    attempt_id: id(),
    batch_id: batch,
    job_id: id(),
    stage,
    state: 'running',
    selection: null,
    actual_model: null,
    progress: 'responding',
    occupies_lane: true,
    session_state: 'running',
    latest_status: null,
    current: true,
    ...overrides,
  } as Session
}

function read(overrides: Partial<HeaderWorkDto> = {}): HeaderWorkDto {
  return {
    actor_id: id(),
    target_id: id(),
    target_context_id: id(),
    observed_at: '2026-11-23T10:00:00Z',
    work: [],
    active_sessions: [],
    work_truncated: false,
    sessions_truncated: false,
    lane_occupied: false,
    paused_batches: [],
    paused_truncated: false,
    ...overrides,
  }
}

const inBatch = { batchId: batch, batchTitle: 'Bench bag', unavailable: false, fresh: true }

describe('workSummary inside a batch', () => {
  it('names a failed step with its count of failed jobs', () => {
    const summary = workSummary({
      ...inBatch,
      data: read({ work: [job('research', 'failed'), job('images', 'ready')] }),
    })

    expect(summary).toMatchObject({
      headline: 'Research failed · 1',
      short: 'Research · 1',
      state: 'failed',
      idle: false,
    })
  })

  it('names the failure first and still shows what waits for the operator', () => {
    const summary = workSummary({
      ...inBatch,
      data: read({
        work: [
          job('examine', 'waiting_for_user'),
          job('identifying', 'waiting_for_user'),
          job('research', 'failed'),
        ],
      }),
    })

    expect(summary.headline).toBe('Research failed · 1')
    expect(summary.detail).toBe('Examine waiting for you · 2')
  })

  it('names steps without counts when the work list is cut at its limit', () => {
    const summary = workSummary({
      ...inBatch,
      data: read({
        work: [job('research', 'failed'), job('research', 'failed')],
        work_truncated: true,
      }),
    })

    expect(summary.headline).toBe('Research failed')
    expect(summary.idle).toBe(false)
  })

  it('says the status is incomplete when a cut work list shows nothing failed or waiting', () => {
    const summary = workSummary({
      ...inBatch,
      data: read({ work: [job('research', 'ready')], work_truncated: true }),
    })

    expect(summary).toMatchObject({ headline: 'Status incomplete', idle: false })
  })

  it('says no agents work only with a fresh, complete read and no lane held', () => {
    const summary = workSummary({
      ...inBatch,
      data: read({ work: [job('research', 'ready'), job('examine', 'ready')] }),
    })

    expect(summary).toMatchObject({ headline: 'Bench bag · no agents working', idle: true })
  })

  it('keeps a cancelled session still holding a lane showing as working', () => {
    const summary = workSummary({
      ...inBatch,
      data: read({
        work: [job('research', 'cancelled', { occupies_lane: true })],
        active_sessions: [session('research', { state: 'cancelled', session_state: 'cancelled' })],
        lane_occupied: true,
      }),
    })

    expect(summary).toMatchObject({ headline: '1 agent working', state: 'working', idle: false })
  })

  it('shows a lane in use when the aggregate flag is set by an unlisted session', () => {
    const summary = workSummary({
      ...inBatch,
      data: read({ work: [job('research', 'ready')], lane_occupied: true }),
    })

    expect(summary).toMatchObject({ headline: 'Agent lane in use', state: 'working', idle: false })
  })

  it('withholds no agents working when only the session list is cut', () => {
    const summary = workSummary({
      ...inBatch,
      data: read({ work: [job('research', 'ready')], sessions_truncated: true }),
    })

    expect(summary).toMatchObject({ headline: 'Status incomplete', idle: false })
  })

  it('names queued work rather than claiming the batch idle', () => {
    const summary = workSummary({ ...inBatch, data: read({ work: [job('images', 'queued')] }) })

    expect(summary).toMatchObject({ headline: 'Images queued', state: 'queued', idle: false })
  })

  it('says what still works after what needs the operator', () => {
    const summary = workSummary({
      ...inBatch,
      data: read({
        work: [job('research', 'failed'), job('images', 'running', { occupies_lane: true })],
        active_sessions: [session('images')],
        lane_occupied: true,
      }),
    })

    expect(summary).toMatchObject({ headline: 'Research failed · 1', detail: '1 agent working' })
  })

  it('counts the agents working in the batch', () => {
    const summary = workSummary({
      ...inBatch,
      data: read({
        work: [job('research', 'running'), job('images', 'running')],
        active_sessions: [session('research'), session('images')],
        lane_occupied: true,
      }),
    })

    expect(summary.headline).toBe('2 agents working')
  })

  it('says Updating… for a stale read and Status unavailable for a failed one', () => {
    const data = read({ work: [job('research', 'failed')] })

    expect(workSummary({ ...inBatch, data, fresh: false }).headline).toBe('Updating…')
    expect(workSummary({ ...inBatch, data: undefined, fresh: false }).headline).toBe('Updating…')
    expect(workSummary({ ...inBatch, data, unavailable: true, fresh: false }).headline).toBe(
      'Status unavailable',
    )
  })

  it('never claims all done or retained work', () => {
    const summaries = [
      workSummary({ ...inBatch, data: read({ work: [job('research', 'ready')] }) }),
      workSummary({ ...inBatch, data: read() }),
    ]

    for (const summary of summaries) {
      expect(summary.headline).not.toMatch(/all done|Retained work/i)
    }
  })
})

describe('workSummary outside a batch', () => {
  const outside = { batchId: undefined, unavailable: false, fresh: true }

  it('claims neither no failures nor no agents working', () => {
    const summary = workSummary({
      ...outside,
      data: read({ work: [job('research', 'failed', { batch_id: other })] }),
    })

    expect(summary.headline).not.toMatch(/failed|no agents working|idle|nothing running/i)
    expect(summary.idle).toBe(false)
  })

  it('names waiting and active work across batches', () => {
    expect(
      workSummary({
        ...outside,
        data: read({ work: [job('research', 'waiting_for_user', { batch_id: other })] }),
      }).headline,
    ).toBe('Research waiting for you · 1')
    expect(
      workSummary({
        ...outside,
        data: read({
          work: [job('images', 'running', { batch_id: other })],
          active_sessions: [session('images', { batch_id: other })],
          lane_occupied: true,
        }),
      }).headline,
    ).toBe('1 agent working')
  })

  it('scopes its headline to one batch and names that batch', () => {
    const summary = workSummary({
      ...outside,
      data: read({
        work: [
          job('images', 'running', { batch_id: other, occupies_lane: true }),
          job('research', 'waiting_for_user', { batch_id: batch }),
        ],
        active_sessions: [session('images', { batch_id: other })],
        lane_occupied: true,
      }),
    })

    expect(summary).toMatchObject({ headline: 'Research waiting for you · 1', batchId: batch })
  })

  it('names the working batch when nothing waits', () => {
    const summary = workSummary({
      ...outside,
      data: read({
        work: [job('images', 'running', { batch_id: other, occupies_lane: true })],
        active_sessions: [session('images', { batch_id: other })],
        lane_occupied: true,
      }),
    })

    expect(summary).toMatchObject({ headline: '1 agent working', batchId: other })
  })
})
