import type { HeaderWorkDto } from '@invimport/contracts'
import type { WorkState } from '#/components/ui'
import { capitalised, jobState, PLANNED, PLANNED_STEP, workState } from './workSegments'

type WorkItem = HeaderWorkDto['work'][number]
type Session = HeaderWorkDto['active_sessions'][number]

/** The masthead's one-line workflow summary and the state its glyph shows. */
export type WorkSummary = {
  headline: string
  /** What follows the headline, such as the waiting count after a failure. */
  detail?: string
  /** The headline's step and count alone ("Research · 1"), for the phone pill beside its glyph. */
  short?: string
  /** Absent while the read cannot say, and for a proven idle batch. */
  state?: WorkState
  /** Only a fresh, complete read with nothing working, waiting or failed and no lane held. */
  idle: boolean
  /** The batch the headline is about, so what is shown beside it names the same batch. */
  batchId?: string
}

export type WorkSummaryInput = {
  data: HeaderWorkDto | undefined
  /** The open batch; outside a batch the read leaves out other batches' settled failures. */
  batchId?: string
  batchTitle?: string
  unavailable: boolean
  fresh: boolean
}

/** Import runs come after the Processing steps, under their own name. */
const STEPS = [...PLANNED.map(capitalised), 'Import']

function stepOf(stage: string, kind: WorkItem['kind'] | 'session') {
  if (kind === 'import') {
    return 'Import'
  }

  return capitalised(PLANNED_STEP[stage] ?? stage)
}

type Entry = { step: string; jobs: number }

/** The steps with jobs in a state, in plan order, counting each job once. */
function stepsIn(state: WorkState, work: WorkItem[], sessions: Session[]): Entry[] {
  const jobs = new Map<string, string>()
  for (const item of work) {
    if (jobState(item) === state) {
      jobs.set(item.id, stepOf(item.stage, item.kind))
    }
  }
  // A session whose job the work list leaves out still counts, once.
  const listed = new Set(work.map((item) => item.id))
  for (const session of sessions) {
    if (!listed.has(session.job_id) && sessionState(session) === state) {
      jobs.set(session.job_id, stepOf(session.stage, 'session'))
    }
  }

  return STEPS.map((step) => ({
    step,
    jobs: [...jobs.values()].filter((own) => own === step).length,
  })).filter((entry) => entry.jobs > 0)
}

function sessionState(session: Session) {
  return workState(session.session_state ?? session.state, { occupiesLane: session.occupies_lane })
}

function phrase(entry: Entry, words: string, counted: boolean) {
  return counted ? `${entry.step} ${words} · ${entry.jobs}` : `${entry.step} ${words}`
}

/** Failures first, then what waits for the operator; without counts when the list is cut. */
function attention(work: WorkItem[], sessions: Session[], counted: boolean, failures: boolean) {
  const failed = failures ? stepsIn('failed', work, sessions) : []
  const waiting = stepsIn('waiting_for_you', work, sessions)

  const short = (entry: Entry) => (counted ? `${entry.step} · ${entry.jobs}` : entry.step)

  return [
    ...failed.map((entry) => ({
      text: phrase(entry, 'failed', counted),
      short: short(entry),
      state: 'failed' as const,
    })),
    ...waiting.map((entry) => ({
      text: phrase(entry, 'waiting for you', counted),
      short: short(entry),
      state: 'waiting_for_you' as const,
    })),
  ]
}

/** "2 agents working" from sessions holding a slot, else the first step with working jobs. */
function working(work: WorkItem[], sessions: Session[], truncated: boolean): string | undefined {
  const holding = sessions.filter((session) => session.occupies_lane).length
  if (holding > 0) {
    const more = truncated ? '+' : ''
    return `${holding}${more} ${holding === 1 && !more ? 'agent' : 'agents'} working`
  }
  const step = stepsIn('working', work, sessions)[0]

  return step && `${step.step} working`
}

/**
 * Outside a batch, the one batch the headline describes: the first waiting for the operator, else
 * the first with work under way, else the first with queued work.
 */
function focusBatch(data: HeaderWorkDto) {
  const batchesIn = (state: WorkState) => [
    ...data.work.filter((item) => jobState(item) === state).map((item) => item.batch_id),
    ...data.active_sessions
      .filter((session) => sessionState(session) === state)
      .map((session) => session.batch_id),
  ]

  return (['waiting_for_you', 'working', 'queued'] as const)
    .map((state) => batchesIn(state)[0])
    .find((batch) => batch !== undefined)
}

const UNAVAILABLE: WorkSummary = { headline: 'Status unavailable', idle: false }
const UPDATING: WorkSummary = { headline: 'Updating…', idle: false }
const INCOMPLETE: WorkSummary = { headline: 'Status incomplete', idle: false }

/**
 * What the masthead says about agent work. Inside a batch it names failed and waiting steps, and
 * says "no agents working" only with proof; outside one it names active and waiting work only,
 * because other batches' settled failures are not in the read. It never claims all is done.
 */
export function workSummary({
  data,
  batchId,
  batchTitle,
  unavailable,
  fresh,
}: WorkSummaryInput): WorkSummary {
  if (unavailable) {
    return UNAVAILABLE
  }
  if (!data || !fresh) {
    return UPDATING
  }

  const inBatch = batchId !== undefined
  const scope = batchId ?? focusBatch(data)
  const work = data.work.filter((item) => item.batch_id === scope)
  const sessions = data.active_sessions.filter((session) => session.batch_id === scope)
  const counted = !data.work_truncated
  const needs = attention(work, sessions, counted, inBatch)
  const active = working(work, sessions, data.sessions_truncated)
  if (needs.length > 0) {
    const [first, ...rest] = needs
    // Work still under way follows what needs the operator.
    const after = [...rest.map((entry) => entry.text), active].filter(Boolean)
    return {
      headline: first.text,
      short: first.short,
      detail: after.length ? after.join(', ') : undefined,
      state: first.state,
      idle: false,
      batchId: scope,
    }
  }
  if (inBatch && data.work_truncated) {
    return INCOMPLETE
  }
  if (active) {
    return { headline: active, state: 'working', idle: false, batchId: scope }
  }
  // The holder can belong to another batch, target or context the read does not list.
  const laneHeld =
    data.lane_occupied || data.active_sessions.some((session) => session.occupies_lane)
  if (laneHeld) {
    return { headline: 'Agent lane in use', state: 'working', idle: false }
  }
  const queued = stepsIn('queued', work, sessions)[0]
  if (queued) {
    return { headline: `${queued.step} queued`, state: 'queued', idle: false, batchId: scope }
  }
  if (!inBatch) {
    return { headline: 'Agent activity', idle: false }
  }
  if (data.sessions_truncated) {
    return INCOMPLETE
  }

  return {
    headline: `${batchTitle ?? 'This batch'} · no agents working`,
    idle: true,
    batchId: scope,
  }
}
