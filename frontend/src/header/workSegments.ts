import type { BatchAttentionDto, HeaderWorkDto, ProcessingJobDto } from '@invimport/contracts'
import { WORK_STATE, type ProgressStep, type WorkState } from '#/components/ui'

type WorkItem = HeaderWorkDto['work'][number]
type Session = HeaderWorkDto['active_sessions'][number]

/** The Processing stages, in plan order. */
export const PLANNED = ['examine', 'research', 'images', 'inventory'] as const

export type Stage = (typeof PLANNED)[number]

/** Reading and Identifying are the Examine step on the redesigned Processing tab. */
export const PLANNED_STEP: Record<string, Stage> = {
  reading: 'examine',
  identifying: 'examine',
  examine: 'examine',
  research: 'research',
  images: 'images',
  inventory: 'inventory',
}

/** One stage's counted work; the header and attention reads count the same fields. */
export type StageCounts = BatchAttentionDto['processing']['steps']['examine']

/** A counted batch: its live lots, whether it is paused, and each stage's work. */
export type BatchCounts = { paused: boolean; lots: number; steps: Record<Stage, StageCounts> }

export function capitalised(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/** Every retained state a job, session, import run or import step can be in. */
export type RetainedState =
  | WorkItem['state']
  | WorkItem['steps'][number]['state']
  | NonNullable<ProcessingJobDto['session_state']>

const RETAINED: Record<RetainedState, WorkState> = {
  queued: 'queued',
  running: 'working',
  waiting_for_user: 'waiting_for_you',
  waiting_input: 'waiting_for_you',
  // Signing in is the operator's to do.
  waiting_for_login: 'waiting_for_you',
  waiting_for_capacity: 'queued',
  ready: 'done',
  finished: 'done',
  confirmed: 'done',
  settled_complete: 'done',
  failed: 'failed',
  interrupted: 'failed',
  resume_unavailable: 'failed',
  settled_incomplete: 'failed',
  recovery_required: 'failed',
  // A replaced attempt's work runs again once its subject is settled.
  superseded: 'queued',
  // Stopped by the operator: nothing is done and nothing runs until it is started again.
  cancelled: 'not_started',
  cancelling: 'working',
  stopping: 'working',
  not_requested: 'not_started',
  none: 'not_started',
  // An import step whose effect is uncertain needs the operator to check it.
  unknown: 'waiting_for_you',
  mixed: 'waiting_for_you',
}

/**
 * The one mapping from retained states to the shared state words. A job still holding its slot is
 * working whatever its logical state; queued work in a paused batch is paused, while a turn still
 * running is still working.
 */
export function workState(
  state: RetainedState,
  context: { occupiesLane?: boolean; paused?: boolean } = {},
): WorkState {
  const own = RETAINED[state]
  if (context.occupiesLane) {
    return 'working'
  }

  return context.paused && own === 'queued' ? 'paused' : own
}

const PRESSING: WorkState[] = [
  'failed',
  'waiting_for_you',
  'working',
  'paused',
  'queued',
  'not_started',
  'done',
]

/** The state that most needs saying: failures, then the operator, then work under way. */
export function mostPressing(states: WorkState[]): WorkState | undefined {
  return PRESSING.find((state) => states.includes(state))
}

/** A Processing job's state, counting a held slot as working. */
export function jobState(item: WorkItem): WorkState {
  return workState(item.state, { occupiesLane: item.kind === 'processing' && item.occupies_lane })
}

/** Whether a job holds its slot although its logical state has stopped working. */
export function slotHeld(item: WorkItem) {
  return item.kind === 'processing' && item.occupies_lane && workState(item.state) !== 'working'
}

function plural(count: number, noun: string) {
  return `${count} ${count === 1 ? noun : `${noun}s`}`
}

function stepName(step: WorkItem['steps'][number]) {
  return 'stage' in step ? step.stage : step.name
}

/** An import run's own steps, in the shared state words. */
export function segmentSteps(item: WorkItem): ProgressStep[] {
  return item.steps.map((step) => ({
    label: capitalised(stepName(step)),
    state: workState(step.state),
  }))
}

/** The Processing stage a retained stage belongs to, if any. */
export function stageOf(stage: string): Stage | undefined {
  return PLANNED_STEP[stage]
}

/** A batch's step counts: the open batch's attention read, else the header read's own count. */
export function batchStepCounts(
  data: HeaderWorkDto | undefined,
  batch: string | undefined,
  attention: BatchAttentionDto | undefined,
): BatchCounts | undefined {
  if (!batch) {
    return undefined
  }
  if (attention?.batch_id === batch) {
    const { paused, lots, steps } = attention.processing
    return { paused, lots, steps }
  }

  const entry = data?.batch_steps?.find((candidate) => candidate.batch_id === batch)
  return entry && { paused: entry.paused, lots: entry.lots, steps: entry.steps }
}

/**
 * Whether a batch is paused. The header read is polled and lists every scoped paused batch, so it
 * decides whenever it has the batch; a cached attention read's flag is used only without it.
 */
export function batchPaused(
  data: HeaderWorkDto | undefined,
  batch: string | undefined,
  counts: BatchCounts | undefined,
) {
  if (!batch) {
    return false
  }
  const listed = data?.paused_batches.some((entry) => entry.batch_id === batch) ?? false
  const entry = data?.batch_steps?.find((candidate) => candidate.batch_id === batch)
  if (listed || entry) {
    return listed || entry!.paused
  }
  if (data && !data.paused_truncated) {
    return false
  }

  return counts?.paused ?? false
}

/** Examine is done once its lead job is ready; a lot stage once every live lot is ready there. */
function stageDone(stage: Stage, counts: StageCounts, lots: number) {
  if (stage === 'examine') {
    return counts.jobs > 0 && counts.ready >= counts.jobs
  }

  return lots > 0 && counts.ready_lots >= lots
}

/**
 * A counted stage's state, most pressing first. A turn already running finishes even in a paused
 * batch, so working outranks paused; a stage with no jobs yet is never done.
 */
function countedState(stage: Stage, counts: StageCounts, lots: number, paused: boolean) {
  const done = stageDone(stage, counts, lots)
  if (counts.failed > 0) {
    return 'failed'
  }
  if (counts.running > 0) {
    return 'working'
  }
  if (paused && !done) {
    return 'paused'
  }
  if (counts.waiting > 0 || counts.questions > 0) {
    return 'waiting_for_you'
  }
  if (counts.queued > 0) {
    return 'queued'
  }

  return done ? 'done' : 'not_started'
}

/** An uncounted stage reads its retained jobs' states, so it is never drawn as not started. */
function retainedState(states: readonly RetainedState[], paused: boolean): WorkState {
  const own = states.map((state) => workState(state))
  const done = own.length > 0 && own.every((state) => state === 'done')
  for (const state of ['failed', 'working'] as const) {
    if (own.includes(state)) {
      return state
    }
  }
  if (paused && !done) {
    return 'paused'
  }
  for (const state of ['waiting_for_you', 'queued'] as const) {
    if (own.includes(state)) {
      return state
    }
  }

  return done ? 'done' : 'not_started'
}

/** One stage's state and ready share, from its counts when the read has them. */
export function stageSegment(
  stage: Stage,
  counts: StageCounts | undefined,
  lots: number | undefined,
  paused: boolean,
  retained: readonly RetainedState[] = [],
): ProgressStep {
  const label = capitalised(stage)
  if (!counts || lots === undefined) {
    return { label, state: retainedState(retained, paused) }
  }

  const state = countedState(stage, counts, lots, paused)
  // Examine fills by its lead job's state; a lot stage by its share of the batch's live lots.
  const fraction = stage !== 'examine' && lots > 0 ? counts.ready_lots / lots : undefined
  return { label, state, ...(fraction === undefined ? {} : { fraction }) }
}

/**
 * A batch's Processing stages in plan order, from its counts where a read counts them, else from
 * the states of its retained jobs.
 */
export function processingSegments(
  items: WorkItem[],
  counts: BatchCounts | undefined,
  paused: boolean,
  sessions: readonly Session[] = [],
): ProgressStep[] {
  const retained = items.flatMap((item) => (item.kind === 'processing' ? item.steps : []))
  // A session whose job was cut from the bounded work list still says what its stage is doing.
  const listed = new Set(
    items.flatMap((item) => (item.kind === 'processing' ? [item.attempt_id] : [])),
  )
  const unlisted = sessions.filter((session) => session.current && !listed.has(session.attempt_id))
  return PLANNED.map((stage) => {
    const states: RetainedState[] = [
      ...retained
        .filter((own) => 'stage' in own && stageOf(own.stage) === stage)
        .map((own) => own.state),
      ...unlisted
        .filter((session) => stageOf(session.stage) === stage)
        .map((session) => session.state),
    ]
    return stageSegment(stage, counts?.steps[stage], counts?.lots, paused, states)
  })
}

/** "Research: 7 of 12" for the first stage counted as working. */
export function processingProgress(counts: BatchCounts | undefined) {
  for (const stage of PLANNED) {
    const own = counts?.steps[stage]
    if (!counts || !own || own.running === 0) {
      continue
    }
    if (stage !== 'examine' && counts.lots > 0) {
      return `${capitalised(stage)}: ${own.ready_lots} of ${counts.lots}`
    }
    if (own.jobs > 0) {
      return `${capitalised(stage)}: ${own.ready} of ${own.jobs}`
    }
  }

  return ''
}

/** A stage row's count: "12 lots formed · 2 questions" for Examine, "7 of 12 lots" after it. */
export function stageCountText(stage: Stage, counts: BatchCounts | undefined) {
  const own = counts?.steps[stage]
  if (!counts || !own) {
    return ''
  }
  if (stage !== 'examine') {
    return `${own.ready_lots} of ${plural(counts.lots, 'lot')}`
  }

  const formed = `${plural(counts.lots, 'lot')} formed`
  return own.questions > 0 ? `${formed} · ${plural(own.questions, 'question')}` : formed
}

/** A stage row's pill word: "2 working" where the read counts who is working. */
export function stagePillWord(state: WorkState, counts: StageCounts | undefined) {
  if (state === 'working' && counts && counts.running > 0) {
    return `${counts.running} working`
  }

  return WORK_STATE[state].word
}

const ENDED_ATTEMPTS = new Set(['cancelled', 'superseded'])

/**
 * A stage's newest agent status line, from its current, uncancelled attempts in the header's
 * bounded active-session list. A cancelled attempt still holding a slot never supplies it.
 */
export function stageStatus(stage: Stage, sessions: readonly Session[]) {
  return sessions
    .filter(
      (session) =>
        stageOf(session.stage) === stage && session.current && !ENDED_ATTEMPTS.has(session.state),
    )
    .map((session) => session.latest_status)
    .filter((status) => status !== null)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0]
}

function lotStageDone(counts: BatchCounts, stage: 'research' | 'images') {
  return counts.lots > 0 && counts.steps[stage].ready_lots >= counts.lots
}

/** What a stage waits on before it can start, or undefined when nothing earlier holds it. */
function waitsOn(stage: Stage, counts: BatchCounts | undefined) {
  if (stage === 'examine' || !counts) {
    return undefined
  }
  if (counts.lots === 0) {
    return 'Starts when Examine forms lots'
  }
  if (
    stage === 'inventory' &&
    !(lotStageDone(counts, 'research') && lotStageDone(counts, 'images'))
  ) {
    return 'Starts when Research and Images finish a lot'
  }

  return undefined
}

/** A stage row's plain reason, shown when no listed agent session gives it a status line. */
export function stageReason(stage: Stage, state: WorkState, counts: BatchCounts | undefined) {
  const own = counts?.steps[stage]
  switch (state) {
    case 'failed':
      return own && own.failed > 1
        ? `${own.failed} attempts failed; open the step to see why`
        : 'An attempt failed; open the step to see why'
    case 'working':
      return 'An agent is working on this step'
    case 'paused':
      return counts && own && stage !== 'examine'
        ? `Paused at ${own.ready_lots} of ${plural(counts.lots, 'lot')}`
        : 'Paused until you resume'
    case 'waiting_for_you':
      return own && own.questions > 0
        ? `${plural(own.questions, 'question')} waiting for your answer`
        : 'Waiting for you'
    case 'queued':
      return waitsOn(stage, counts) ?? 'Queued for a free slot'
    case 'done':
      return stage === 'examine' ? 'Examine finished' : 'Every lot is done'
    case 'not_started':
      return waitsOn(stage, counts) ?? 'Not started yet'
  }
}

const SETTLED = ['ready', 'confirmed', 'finished', 'cancelled', 'superseded', 'settled_complete']

/** A batch's Processing jobs read as one entry; each import run is its own. */
export function jobGroup(item: WorkItem) {
  return item.kind === 'processing' ? `processing:${item.batch_id}` : `import:${item.id}`
}

/** Other entries still under way, apart from the one the indicator names. */
export function otherOpenJobs(work: WorkItem[], named: WorkItem | undefined) {
  // A job still holding its slot is under way, whatever its logical state.
  const open = work
    .filter(
      (item) => !SETTLED.includes(item.state) || (item.kind === 'processing' && item.occupies_lane),
    )
    .map(jobGroup)
  const others = new Set(open.filter((group) => !named || group !== jobGroup(named)))
  return others.size
}

/** A batch's Processing entry takes the most pressing of its jobs' states. */
export function batchState(jobs: WorkItem[]): WorkState {
  return mostPressing(jobs.map(jobState)) ?? 'queued'
}
