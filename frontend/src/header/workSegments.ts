import type { BatchAttentionDto, HeaderWorkDto } from '@invimport/contracts'
import type { PillStatus } from '../components/ui/Pill'
import type { ProgressStep, SegmentState } from '../components/ui/ProgressSegments'

type WorkItem = HeaderWorkDto['work'][number]
type StepCounts =
  BatchAttentionDto['processing']['steps'][keyof BatchAttentionDto['processing']['steps']]

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

/** The attention read's attempt counts for a Processing step, where it has them. */
function stepCounts(
  step: WorkItem['steps'][number],
  attention: BatchAttentionDto | undefined,
): StepCounts | undefined {
  const steps = attention?.processing.steps
  if (!steps || !('stage' in step) || !(step.stage in steps)) {
    return undefined
  }

  return steps[step.stage as keyof typeof steps]
}

/** A running step fills by its ready share only where the batch's attention read counts it. */
export function segmentSteps(
  item: WorkItem,
  attention: BatchAttentionDto | undefined,
): ProgressStep[] {
  return item.steps.map((step) => {
    const counts = stepCounts(step, attention)
    return {
      label: capitalised(stepName(step)),
      state: segmentState(step.state),
      fraction: counts?.jobs ? counts.ready / counts.jobs : undefined,
    }
  })
}

/** "Research: 7 of 12" for the first running step the attention read counts. */
export function runningStepProgress(item: WorkItem, attention: BatchAttentionDto | undefined) {
  for (const step of item.steps) {
    const counts = stepCounts(step, attention)
    if (segmentState(step.state) === 'running' && counts?.jobs) {
      return `${capitalised(stepName(step))}: ${counts.ready} of ${counts.jobs}`
    }
  }

  return ''
}

const SETTLED = ['ready', 'confirmed', 'finished', 'cancelled', 'superseded', 'settled_complete']

/** Jobs still under way, apart from the one the indicator names. */
export function otherOpenJobs(work: WorkItem[], named: WorkItem | undefined) {
  return work.filter((item) => item !== named && !SETTLED.includes(item.state)).length
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

/** A job's state pill; open questions on the batch outrank its run state, as on the canvas. */
export function jobPill(item: WorkItem, questions: number): JobPill {
  if (questions > 0) {
    return { status: 'needs-answer', word: `${questions} need you` }
  }
  if (item.kind === 'processing' && item.occupies_lane && !JOB_PILL[item.state]) {
    return JOB_PILL.running
  }

  return JOB_PILL[item.state] ?? { status: 'draft', word: capitalised(stateWords(item.state)) }
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
