import type { HeaderWorkDto } from '@invimport/contracts'
import { describe, expect, it } from 'vitest'
import {
  batchPaused,
  mostPressing,
  workState,
  processingSegments,
  stageCountText,
  stagePillWord,
  stageReason,
  stageStatus,
  type BatchCounts,
  type StageCounts,
} from './workSegments'

type WorkItem = HeaderWorkDto['work'][number]
type Session = HeaderWorkDto['active_sessions'][number]

const batch = 'b0000000-0000-4000-8000-000000000001'
const none: StageCounts = {
  jobs: 0,
  ready: 0,
  running: 0,
  waiting: 0,
  queued: 0,
  questions: 0,
  failed: 0,
  ready_lots: 0,
}

function counts(
  steps: Partial<Record<keyof BatchCounts['steps'], Partial<StageCounts>>>,
  lots = 12,
  paused = false,
): BatchCounts {
  return {
    paused,
    lots,
    steps: {
      examine: { ...none, ...steps.examine },
      research: { ...none, ...steps.research },
      images: { ...none, ...steps.images },
      inventory: { ...none, ...steps.inventory },
    },
  }
}

function job(stage: string, state: string, id = 1): WorkItem {
  return {
    kind: 'processing',
    id: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
    batch_id: batch,
    attempt_id: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
    stage,
    state,
    input_current: true,
    occupies_lane: state === 'running',
    blocked_code: null,
    steps: [{ stage, state }],
    steps_complete: false,
  } as WorkItem
}

const states = (steps: ReturnType<typeof processingSegments>) => steps.map((step) => step.state)

describe('processingSegments', () => {
  it('reads the most pressing state of each stage: failed, working, paused, waiting, queued, done', () => {
    const steps = processingSegments(
      [],
      counts({
        examine: { jobs: 1, ready: 1 },
        // Working and failed jobs together: the failure is what needs the operator.
        research: { jobs: 12, running: 2, failed: 1, ready_lots: 7 },
        images: { jobs: 12, waiting: 1, queued: 2, ready_lots: 9 },
        inventory: { jobs: 2, queued: 2 },
      }),
      false,
    )

    expect(states(steps)).toEqual(['done', 'failed', 'waiting_for_you', 'queued'])
  })

  it('keeps a turn still running after the pause working, and pauses the unfinished rest', () => {
    const steps = processingSegments(
      [],
      counts(
        {
          examine: { jobs: 1, ready: 1, ready_lots: 0 },
          research: { jobs: 12, running: 1, ready_lots: 7 },
          images: { jobs: 12, ready: 9, ready_lots: 9 },
          inventory: none,
        },
        12,
        true,
      ),
      true,
    )

    expect(states(steps)).toEqual(['done', 'working', 'paused', 'paused'])
    // The paused stage keeps its ready share.
    expect(steps[2].fraction).toBe(0.75)
  })

  it('never calls a stage with no jobs yet done', () => {
    const empty = processingSegments([], counts({}, 12), false)
    expect(states(empty)).toEqual(['not_started', 'not_started', 'not_started', 'not_started'])

    const noLots = processingSegments([], counts({ research: { jobs: 1, ready: 1 } }, 0), false)
    expect(noLots[1].state).toBe('not_started')
  })

  it('fills a lot stage to its ready lots, and draws Examine by its lead job', () => {
    const steps = processingSegments(
      [],
      counts({
        examine: { jobs: 1, running: 1 },
        research: { jobs: 12, running: 2, ready_lots: 7 },
        images: { jobs: 12, ready: 12, ready_lots: 12 },
      }),
      false,
    )

    expect(steps.map((step) => step.fraction)).toEqual([undefined, 7 / 12, 1, 0])
    expect(steps[2].state).toBe('done')
  })

  it('fills nothing without counts, and reads uncounted stages from their retained jobs', () => {
    const steps = processingSegments(
      [job('reading', 'running', 1), job('research', 'waiting_for_user', 2)],
      undefined,
      false,
    )

    expect(states(steps)).toEqual(['working', 'waiting_for_you', 'not_started', 'not_started'])
    expect(steps.every((step) => step.fraction === undefined)).toBe(true)
  })

  it('reads Examine waiting on questions as waiting for you, even with its lead job ready', () => {
    const steps = processingSegments(
      [],
      counts({ examine: { jobs: 1, ready: 1, questions: 2 } }),
      false,
    )

    expect(steps[0].state).toBe('waiting_for_you')
    expect(steps.some((step) => step.state === 'working')).toBe(false)
  })

  it('pauses an uncounted batch from the header’s list of paused batches', () => {
    const data = { paused_batches: [{ batch_id: batch, title: 'Heyyy' }] } as HeaderWorkDto
    const paused = batchPaused(data, batch, undefined)
    const steps = processingSegments([job('research', 'queued')], undefined, paused)

    expect(paused).toBe(true)
    expect(steps[1].state).toBe('paused')
  })

  it('takes the pause from the header read over a cached attention read, both ways', () => {
    const header = (paused: boolean) =>
      ({
        paused_batches: paused ? [{ batch_id: batch, title: 'Heyyy' }] : [],
        paused_truncated: false,
        batch_steps: [],
      }) as unknown as HeaderWorkDto

    expect(batchPaused(header(true), batch, counts({}, 12, false))).toBe(true)
    expect(batchPaused(header(false), batch, counts({}, 12, true))).toBe(false)
    // Without the header read, the attention read's flag is all there is.
    expect(batchPaused(undefined, batch, counts({}, 12, true))).toBe(true)
  })
})

describe('stage rows', () => {
  const working = counts({
    examine: { jobs: 1, ready: 1, questions: 2 },
    research: { jobs: 12, running: 2, ready_lots: 7 },
    images: { jobs: 12, running: 1, ready_lots: 9 },
    inventory: { jobs: 1, queued: 1 },
  })

  it('counts lots formed and questions for Examine, and ready lots after it', () => {
    expect(stageCountText('examine', working)).toBe('12 lots formed · 2 questions')
    expect(stageCountText('research', working)).toBe('7 of 12 lots')
    expect(stageCountText('inventory', working)).toBe('0 of 12 lots')
    expect(stageCountText('research', undefined)).toBe('')
  })

  it('says how many are working, else the state word', () => {
    expect(stagePillWord('working', working.steps.research)).toBe('2 working')
    expect(stagePillWord('working', undefined)).toBe('Working')
    expect(stagePillWord('queued', working.steps.inventory)).toBe('Queued')
    expect(stagePillWord('waiting_for_you', working.steps.examine)).toBe('Waiting for you')
  })

  it('gives a plain reason for a stage waiting on earlier ones', () => {
    expect(stageReason('inventory', 'queued', working)).toBe(
      'Starts when Research and Images finish a lot',
    )
    expect(stageReason('research', 'not_started', counts({}, 0))).toBe(
      'Starts when Examine forms lots',
    )
    expect(stageReason('images', 'paused', working)).toBe('Paused at 9 of 12 lots')
    expect(stageReason('research', 'done', working)).toBe('Every lot is done')
  })

  const session = (overrides: Partial<Session>): Session => ({
    attempt_id: 'a0000000-0000-4000-8000-000000000001',
    batch_id: batch,
    job_id: 'a0000000-0000-4000-8000-000000000001',
    stage: 'research',
    state: 'running',
    selection: null,
    actual_model: null,
    progress: 'responding',
    occupies_lane: true,
    session_state: 'running',
    latest_status: { text: 'Reading the datasheet', at: '2026-11-23T03:00:00.000Z' },
    current: true,
    ...overrides,
  })

  it('takes the newest line of a stage’s current, uncancelled attempts', () => {
    const lines = [
      session({ latest_status: { text: 'Older line', at: '2026-11-23T02:00:00.000Z' } }),
      session({}),
      session({
        stage: 'images',
        latest_status: { text: 'Images', at: '2026-11-23T04:00:00.000Z' },
      }),
    ]
    expect(stageStatus('research', lines)?.text).toBe('Reading the datasheet')
    expect(stageStatus('examine', lines)).toBeUndefined()
  })

  it('never takes a line from a cancelled attempt still holding its slot', () => {
    const held = [
      session({ state: 'cancelled', current: true }),
      session({ current: false, latest_status: { text: 'Earlier', at: '2026-11-23T05:00:00Z' } }),
    ]
    expect(stageStatus('research', held)).toBeUndefined()
  })
})

describe('workState', () => {
  it.each([
    // Processing jobs
    ['queued', 'queued'],
    ['running', 'working'],
    ['waiting_for_user', 'waiting_for_you'],
    ['waiting_for_login', 'waiting_for_you'],
    ['waiting_for_capacity', 'queued'],
    ['ready', 'done'],
    ['failed', 'failed'],
    ['cancelled', 'not_started'],
    ['superseded', 'queued'],
    ['interrupted', 'failed'],
    // Sessions
    ['waiting_input', 'waiting_for_you'],
    ['finished', 'done'],
    ['cancelling', 'working'],
    ['resume_unavailable', 'failed'],
    // Import runs and their steps
    ['stopping', 'working'],
    ['settled_complete', 'done'],
    ['settled_incomplete', 'failed'],
    ['recovery_required', 'failed'],
    ['confirmed', 'done'],
    ['not_requested', 'not_started'],
    ['none', 'not_started'],
    ['unknown', 'waiting_for_you'],
    ['mixed', 'waiting_for_you'],
  ] as const)('reads retained %s as %s', (state, expected) => {
    expect(workState(state)).toBe(expected)
  })

  it('reads a job still holding its slot as working, whatever its logical state', () => {
    expect(workState('cancelled', { occupiesLane: true })).toBe('working')
    expect(workState('ready', { occupiesLane: true })).toBe('working')
  })

  it('reads queued work in a paused batch as paused, and a turn still running as working', () => {
    expect(workState('queued', { paused: true })).toBe('paused')
    expect(workState('waiting_for_capacity', { paused: true })).toBe('paused')
    expect(workState('running', { paused: true })).toBe('working')
    expect(workState('ready', { paused: true })).toBe('done')
  })
})

describe('mostPressing', () => {
  it('puts failures first, then what waits for the operator, then work under way', () => {
    expect(mostPressing(['done', 'working', 'failed', 'waiting_for_you'])).toBe('failed')
    expect(mostPressing(['done', 'working', 'waiting_for_you'])).toBe('waiting_for_you')
    expect(mostPressing(['done', 'queued', 'working'])).toBe('working')
    expect(mostPressing(['done', 'queued', 'paused'])).toBe('paused')
    expect(mostPressing(['done', 'not_started'])).toBe('not_started')
    expect(mostPressing(['done', 'done'])).toBe('done')
    expect(mostPressing([])).toBeUndefined()
  })
})
