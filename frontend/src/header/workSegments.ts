import type { BatchAttentionDto, HeaderWorkDto } from '@invimport/contracts'
import type { PillStatus } from '../components/ui/Pill'
import type { ProgressStep, SegmentState } from '../components/ui/ProgressSegments'

type WorkItem = HeaderWorkDto['work'][number]
/** The header read counts jobs only; the attention read also counts each step's failures. */
type StepCounts = { jobs: number; ready: number; running: number; failed?: number }
type BatchStepCounts = Record<(typeof PLANNED)[number], StepCounts>

function capitalised(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/** State words as a reader says them: `waiting_for_user` reads "waiting for user". */
export function stateWords(state: string) {
  return state.replaceAll('_', ' ')
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

const PLANNED = ['examine', 'research', 'images', 'inventory'] as const

/** Reading and Identifying are the Examine step on the redesigned Processing tab. */
const PLANNED_STEP: Record<string, (typeof PLANNED)[number]> = {
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

function retainedState(states: string[]): SegmentState {
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

type JobPill = { status: PillStatus; word: string }

const JOB_PILL: Record<string, JobPill> = {
  running: { status: 'running', word: 'Running' },
  stopping: { status: 'running', word: 'Stopping' },
  queued: { status: 'queued', word: 'Queued' },
  waiting_for_capacity: { status: 'queued', word: 'Queued' },
  waiting_for_user: { status: 'needs-answer', word: 'Waiting for you' },
  waiting_for_login: { status: 'warning', word: 'Waiting for login' },
  failed: { status: 'failed', word: 'Failed' },
  interrupted: { status: 'failed', word: 'Interrupted' },
  recovery_required: { status: 'failed', word: 'Needs recovery' },
  settled_incomplete: { status: 'failed', word: 'Incomplete' },
  ready: { status: 'complete', word: 'Done' },
  settled_complete: { status: 'complete', word: 'Done' },
  cancelled: { status: 'excluded', word: 'Cancelled' },
  superseded: { status: 'excluded', word: 'Superseded' },
}

/** A job's state pill. A job that still holds its slot says so, whatever its logical state. */
export function jobPill(item: WorkItem): JobPill {
  const own = JOB_PILL[item.state] ?? {
    status: 'draft' as const,
    word: capitalised(stateWords(item.state)),
  }
  if (item.kind === 'processing' && item.occupies_lane && own.status !== 'running') {
    return { status: 'running', word: `${own.word} · slot held` }
  }

  return own
}

const PILL_RANK: PillStatus[] = [
  'failed',
  'needs-answer',
  'warning',
  'running',
  'queued',
  'complete',
]

/** A batch's Processing entry takes the most pressing of its jobs' pills. */
export function batchPill(jobs: WorkItem[]): JobPill {
  const pills = jobs.map(jobPill)

  const rank = (pill: JobPill) => {
    const index = PILL_RANK.indexOf(pill.status)
    return index === -1 ? PILL_RANK.length : index
  }

  return pills.sort((a, b) => rank(a) - rank(b))[0] ?? JOB_PILL.queued
}

/** One short word for the phone pill; a held slot outranks the job's logical state. */
export function compactJobWord(item: WorkItem) {
  if (item.kind === 'processing' && item.occupies_lane && segmentState(item.state) !== 'running') {
    return 'Slot held'
  }

  return jobPill(item).word
}

/** Only a step that is running fills; queued and waiting steps hold no progress yet. */
function segmentState(state: string): SegmentState {
  const tone = stepTone(state)
  if (tone === 'done' || tone === 'failed') {
    return tone
  }

  return state === 'running' ? 'running' : 'waiting'
}

type StepTone = 'done' | 'running' | 'failed' | 'other'

const STEP_TONE: Record<string, StepTone> = {
  ready: 'done',
  confirmed: 'done',
  finished: 'done',
  queued: 'running',
  running: 'running',
  waiting_for_user: 'running',
  waiting_for_login: 'running',
  waiting_for_capacity: 'running',
  failed: 'failed',
  interrupted: 'failed',
  cancelled: 'failed',
}

export function stepTone(state: string): StepTone {
  return STEP_TONE[state] ?? 'other'
}
