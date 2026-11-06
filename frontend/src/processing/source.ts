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

/**
 * What Processing presents, whatever produces it. Today's adapter reads retained jobs; a later
 * one adds observations and session status lines.
 */
export type ProcessingSource = {
  steps: StepProgress[]
  questions: SourceQuestion[]
  sessions: SourceSession[]
  jobsOn: (step: WorkStep) => Job[]
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
      .map((question) => ({
        id: question.id,
        jobId: job.id,
        step: workStep(job),
        subject: subjects.get(question.spec.subject_id) ?? subject(job),
        prompt: question.spec.prompt,
        assumption: question.assumption ?? null,
        lotId: activeLotIds.has(question.spec.subject_id) ? question.spec.subject_id : null,
      })),
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
  }
}
