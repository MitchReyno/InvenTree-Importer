import type { BatchAttentionDto, HeaderWorkDto, ProcessingJobDto } from '@invimport/contracts'
import { type ProgressStep, type SegmentState, type WorkState } from '#/components/ui'

type WorkItem = HeaderWorkDto['work'][number]
/** The header read counts jobs only; the attention read also counts each step's failures. */
type StepCounts = { jobs: number; ready: number; running: number; failed?: number }
type BatchStepCounts = Record<(typeof PLANNED)[number], StepCounts>

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

function stepName(step: WorkItem['steps'][number]) {
  return 'stage' in step ? step.stage : step.name
}

/** An import run's own steps; it fills only what its retained states say. */
export function segmentSteps(item: WorkItem): ProgressStep[] {
  return item.steps.map((step) => ({
    label: capitalised(stepName(step)),
    state: segmentState(step.state),
  }))
}

export const PLANNED = ['examine', 'research', 'images', 'inventory'] as const

/** Reading and Identifying are the Examine step on the redesigned Processing tab. */
export const PLANNED_STEP: Record<string, (typeof PLANNED)[number]> = {
  reading: 'examine',
  identifying: 'examine',
  examine: 'examine',
  research: 'research',
  images: 'images',
  inventory: 'inventory',
}

/** A batch's step counts: the open batch's attention read, else the header read's own count. */
export function batchStepCounts(
  data: HeaderWorkDto | undefined,
  batch: string | undefined,
  attention: BatchAttentionDto | undefined,
): BatchStepCounts | undefined {
  if (!batch) {
    return undefined
  }
  if (attention?.batch_id === batch) {
    return attention.processing.steps
  }

  return data?.batch_steps?.find((entry) => entry.batch_id === batch)?.steps
}

/**
 * A batch's Processing steps in plan order. Each retained job is one step, so the steps come from all
 * of the batch's jobs, filled by the counted ready share where a read counts the step.
 */
export function processingSegments(
  items: WorkItem[],
  steps: BatchStepCounts | undefined,
): ProgressStep[] {
  const retained = items.flatMap((item) => (item.kind === 'processing' ? item.steps : []))
  return PLANNED.map((step) => {
    const counts = steps?.[step]
    const states = retained
      .filter((own) => 'stage' in own && PLANNED_STEP[own.stage] === step)
      .map((own) => own.state)
    return {
      label: capitalised(step),
      state: counts?.jobs ? countedState(counts, retainedState(states)) : retainedState(states),
      fraction: counts?.jobs ? counts.ready / counts.jobs : undefined,
    }
  })
}

/** Without a failure count, a retained failed job still marks its step failed. */
function countedState(counts: StepCounts, retained: SegmentState): SegmentState {
  if (counts.running > 0) {
    return 'running'
  }
  if ((counts.failed ?? 0) > 0 || (counts.failed === undefined && retained === 'failed')) {
    return 'failed'
  }

  return counts.ready >= counts.jobs ? 'done' : 'waiting'
}

function retainedState(states: RetainedState[]): SegmentState {
  const segments = states.map(segmentState)
  if (segments.includes('running')) {
    return 'running'
  }
  if (segments.includes('failed')) {
    return 'failed'
  }

  return segments.length > 0 && segments.every((state) => state === 'done') ? 'done' : 'waiting'
}

/** "Research: 7 of 12" for the first step counted as running. */
export function processingProgress(steps: BatchStepCounts | undefined) {
  for (const step of PLANNED) {
    const counts = steps?.[step]
    if (counts?.jobs && counts.running > 0) {
      return `${capitalised(step)}: ${counts.ready} of ${counts.jobs}`
    }
  }

  return ''
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

/** Only a step that is working fills; queued and waiting steps hold no progress yet. */
function segmentState(state: RetainedState): SegmentState {
  const own = workState(state)
  if (own === 'working') {
    return 'running'
  }

  return own === 'done' || own === 'failed' ? own : 'waiting'
}
