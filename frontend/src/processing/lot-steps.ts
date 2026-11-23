import type { CaptureSnapshotDto, ProcessingSnapshotDto } from '@invimport/contracts'
import { WORK_STATE, type WorkState } from '#/components/ui'
import { mostPressing, workState } from '#/header/workSegments'
import { processingStepFor } from '#/navigation/batch-route'
import type { WorkStep } from './source'

type Job = ProcessingSnapshotDto['jobs'][number]
type Lot = CaptureSnapshotDto['lots'][number]

/** The steps that run per lot; Examine runs once for the whole batch. */
export type LotStage = 'research' | 'images' | 'inventory'

export const LOT_STAGES: { step: LotStage; label: string }[] = [
  { step: 'research', label: 'Research' },
  { step: 'images', label: 'Images' },
  { step: 'inventory', label: 'Inventory' },
]

/** A lot's state at one step, from its own job or, failing that, its Part's. */
export type LotStep = {
  state: WorkState
  /** The job the state comes from; null while no job covers the lot at this step. */
  job: Job | null
  /** The Part whose job covers the lot, when the output is shared through it. */
  partId: string | null
}

export type LotSteps = { lotId: string; label: string; steps: Record<LotStage, LotStep> }

/** A replaced or stopped attempt yields to another job for the same subject and step. */
const REPLACED: ReadonlySet<string> = new Set(['superseded', 'cancelled'])

function currentJob(jobs: Job[]) {
  return jobs.findLast((job) => !REPLACED.has(job.state)) ?? jobs.at(-1)
}

function jobsOn(jobs: Job[], subjectId: string | null, step: LotStage) {
  if (subjectId === null) {
    return []
  }

  return jobs.filter((job) => job.subject_id === subjectId && processingStepFor(job.stage) === step)
}

function lotStep(jobs: Job[], lot: Lot, step: LotStage, paused: boolean): LotStep {
  const own = currentJob(jobsOn(jobs, lot.id, step))
  const shared = own ? undefined : currentJob(jobsOn(jobs, lot.part_subject_id, step))
  const job = own ?? shared
  if (!job) {
    return { state: 'not_started', job: null, partId: null }
  }

  return {
    state: workState(job.state, { paused }),
    job,
    partId: shared ? lot.part_subject_id : null,
  }
}

/**
 * One row per given lot, by label, with each per-lot step's state. Pass live lots only; a Part's
 * job appears under every lot of that Part.
 */
export function lotSteps(
  jobs: Job[],
  lots: readonly Lot[],
  { paused = false }: { paused?: boolean } = {},
): LotSteps[] {
  return lots
    .map((lot) => ({
      lotId: lot.id,
      label: lot.label,
      steps: {
        research: lotStep(jobs, lot, 'research', paused),
        images: lotStep(jobs, lot, 'images', paused),
        inventory: lotStep(jobs, lot, 'inventory', paused),
      },
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`
}

/** The order a step page's summary lists lot states in. */
const LISTED: WorkState[] = ['working', 'waiting_for_you', 'queued', 'paused', 'failed', 'done']

export type StepSummary = { text: string; state: WorkState }

/**
 * A step page's own summary: the distinct lots its jobs cover and their states, such as "2 lots ·
 * 1 working · 1 done". Examine runs once for the batch, so it counts the lots formed.
 */
export function stepSummary(
  step: WorkStep,
  rows: readonly LotSteps[],
  examineJobs: readonly Job[],
): StepSummary {
  if (step === 'examine') {
    const state = mostPressing(examineJobs.map((job) => workState(job.state))) ?? 'not_started'
    const text = rows.length ? `${plural(rows.length, 'lot')} formed` : 'No lots formed yet'
    return { text, state }
  }

  const covered = rows.map((row) => row.steps[step]).filter((cell) => cell.job !== null)
  if (covered.length === 0) {
    return { text: 'No work yet', state: 'not_started' }
  }
  const states = covered.map((cell) => cell.state)
  const counts = LISTED.flatMap((state) => {
    const lots = states.filter((own) => own === state).length
    return lots ? [`${lots} ${WORK_STATE[state].word.toLowerCase()}`] : []
  })

  return {
    text: [plural(covered.length, 'lot'), ...counts].join(' · '),
    state: mostPressing(states) ?? 'not_started',
  }
}
