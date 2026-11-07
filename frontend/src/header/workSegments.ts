import type { BatchAttentionDto, HeaderWorkDto } from '@invimport/contracts'
import type { ProgressStep, SegmentState } from '../components/ui/ProgressSegments'

type WorkItem = HeaderWorkDto['work'][number]

/** A running step fills by its ready share only where the batch's attention read counts it. */
export function segmentSteps(
  item: WorkItem,
  attention: BatchAttentionDto | undefined,
): ProgressStep[] {
  return item.steps.map((step) => {
    const label = 'stage' in step ? step.stage : step.name
    const steps = attention?.processing.steps
    const counts =
      steps && 'stage' in step && step.stage in steps
        ? steps[step.stage as keyof typeof steps]
        : undefined
    return {
      label,
      state: segmentState(step.state),
      fraction: counts?.jobs ? counts.ready / counts.jobs : undefined,
    }
  })
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
