import type { ProcessingSnapshotDto } from '@invimport/contracts'
import { processingStepFor } from '../navigation/batch-route'

type Job = ProcessingSnapshotDto['jobs'][number]

export type WorkStep = 'examine' | 'research' | 'images' | 'inventory'

export const WORK_STEPS: { step: WorkStep; label: string }[] = [
  { step: 'examine', label: 'Examine' },
  { step: 'research', label: 'Research' },
  { step: 'images', label: 'Images' },
  { step: 'inventory', label: 'Inventory' },
]

/** Retained step state in counts; Processing never reduces it to one percentage. */
export type StepProgress = {
  step: WorkStep
  label: string
  jobs: number
  queued: number
  running: number
  waiting: number
  ready: number
  failed: number
  questions: number
}

export type SourceQuestion = {
  id: string
  jobId: string
  step: WorkStep
  subject: string
  prompt: string
  assumption: string | null
  /** The active lot the question is about, which Review can open. */
  lotId: string | null
}

export type SourceSession = {
  jobId: string
  step: WorkStep
  subject: string
  state: NonNullable<Job['session_state']>
}

/** A lot's step in the pipeline: its job's state and how many of its proposals need a look. */
export type PipelineCell = {
  jobId: string
  state: Job['state']
  stale: number
  provisional: number
} | null

export type PipelineStage = 'research' | 'images' | 'inventory'

/** Research and Images run in parallel once the lot's identity is stable; Inventory follows. */
export type PipelineLot = {
  lotId: string
  label: string
  cells: Record<PipelineStage, PipelineCell>
}

/** What Processing presents, whatever produces it. */
export type ProcessingSource = {
  steps: StepProgress[]
  questions: SourceQuestion[]
  sessions: SourceSession[]
  jobsOn: (step: WorkStep) => Job[]
  /** The batch's Examine lead job, then each lot's per-lot work. */
  pipeline: { lead: { jobId: string; state: Job['state'] } | null; lots: PipelineLot[] }
}

const PIPELINE_STAGES: readonly PipelineStage[] = ['research', 'images', 'inventory']

function cell(job: Job): NonNullable<PipelineCell> {
  const count = (state: string) =>
    job.proposals.filter((proposal) => proposal.currentness?.state === state).length

  return {
    jobId: job.id,
    state: job.state,
    stale: count('stale'),
    provisional: count('provisional'),
  }
}

function pipeline(
  snapshot: ProcessingSnapshotDto,
  subjects: ReadonlyMap<string, string>,
): ProcessingSource['pipeline'] {
  const lead = snapshot.jobs.find((job) => job.stage === 'examine' && job.subject_id === null)
  const byLot = new Map<string, PipelineLot>()
  for (const job of snapshot.jobs) {
    const stage = job.stage as string
    // Only session work forms the pipeline; legacy attempts stay in their step pages.
    if (
      !job.session_state ||
      job.subject_id === null ||
      !(PIPELINE_STAGES as readonly string[]).includes(stage)
    ) {
      continue
    }
    const row = byLot.get(job.subject_id) ?? {
      lotId: job.subject_id,
      label: subjects.get(job.subject_id) ?? 'Unknown subject',
      cells: { research: null, images: null, inventory: null },
    }
    row.cells[stage as PipelineStage] = cell(job)
    byLot.set(job.subject_id, row)
  }
  return {
    lead: lead ? { jobId: lead.id, state: lead.state } : null,
    lots: [...byLot.values()].sort((a, b) => a.label.localeCompare(b.label)),
  }
}

const WAITING = new Set(['waiting_for_user', 'waiting_for_login', 'waiting_for_capacity'])
const FAILED = new Set(['failed', 'interrupted'])

function workStep(job: Job): WorkStep {
  const step = processingStepFor(job.stage)
  return step === 'overview' ? 'examine' : step
}

export function retainedJobsSource(
  snapshot: ProcessingSnapshotDto,
  subjects: ReadonlyMap<string, string>,
  activeLotIds: ReadonlySet<string> = new Set(),
): ProcessingSource {
  const subject = (job: Job) =>
    job.subject_id === null ? 'Whole batch' : (subjects.get(job.subject_id) ?? 'Unknown subject')

  const jobsOn = (step: WorkStep) => snapshot.jobs.filter((job) => workStep(job) === step)

  const questions = snapshot.jobs.flatMap((job) =>
    job.questions
      .filter((question) => question.state === 'open')
      .map((question) => {
        // The Examine lead session can ask about the whole batch.
        const about = question.spec.subject_id
        return {
          id: question.id,
          jobId: job.id,
          step: workStep(job),
          subject: about === null ? 'Whole batch' : (subjects.get(about) ?? subject(job)),
          prompt: question.spec.prompt,
          assumption: question.assumption ?? null,
          lotId: about !== null && activeLotIds.has(about) ? about : null,
        }
      }),
  )

  return {
    steps: WORK_STEPS.map(({ step, label }) => {
      const jobs = jobsOn(step)

      const count = (match: (job: Job) => boolean) => jobs.filter(match).length

      return {
        step,
        label,
        jobs: jobs.length,
        queued: count((job) => job.state === 'queued'),
        running: count((job) => job.state === 'running'),
        waiting: count((job) => WAITING.has(job.state)),
        ready: count((job) => job.state === 'ready'),
        failed: count((job) => FAILED.has(job.state)),
        questions: questions.filter((question) => question.step === step).length,
      }
    }),
    questions,
    sessions: snapshot.jobs.flatMap((job) =>
      job.session_state
        ? [{ jobId: job.id, step: workStep(job), subject: subject(job), state: job.session_state }]
        : [],
    ),
    jobsOn,
    pipeline: pipeline(snapshot, subjects),
  }
}
