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
  /** The active lot the session works on; null for the Examine lead session. */
  lotId: string | null
  state: NonNullable<Job['session_state']>
  /** The session's newest status line, if it has posted one. */
  status: string | null
}

export type LotStatus = { step: WorkStep; text: string; state: SourceSession['state'] }

/** What Processing presents from retained jobs, with session state and status lines. */
export type ProcessingSource = {
  steps: StepProgress[]
  questions: SourceQuestion[]
  sessions: SourceSession[]
  /** The batch's Examine lead session. */
  lead: SourceSession | null
  jobsOn: (step: WorkStep) => Job[]
}

const WAITING = new Set(['waiting_for_user', 'waiting_for_login', 'waiting_for_capacity'])
const FAILED = new Set(['failed', 'interrupted'])

function workStep(job: Job): WorkStep {
  const step = processingStepFor(job.stage)
  return step === 'overview' ? 'examine' : step
}

/** Sessions that will not read another message; Processing offers a fresh one instead. */
export const ENDED_SESSIONS: ReadonlySet<string> = new Set([
  'cancelled',
  'cancelling',
  'failed',
  'resume_unavailable',
])

/** The batch's Examine lead job: the batch-level Examine job that runs as a session. */
export function examineLead(snapshot: Pick<ProcessingSnapshotDto, 'jobs'>) {
  return (
    snapshot.jobs.find(
      (job) => job.stage === 'examine' && job.subject_id === null && job.session_state,
    ) ?? null
  )
}

/** Each subject's newest status line across its live session jobs: finished or ended ones are history. */
export function subjectStatuses(snapshot: Pick<ProcessingSnapshotDto, 'jobs'>) {
  const newest = new Map<string, Job>()
  for (const job of snapshot.jobs) {
    if (
      job.subject_id === null ||
      !job.session_state ||
      job.session_state === 'finished' ||
      ENDED_SESSIONS.has(job.session_state) ||
      !job.latest_status
    ) {
      continue
    }
    const known = newest.get(job.subject_id)
    if (!known || job.latest_status.at > known.latest_status!.at) {
      newest.set(job.subject_id, job)
    }
  }
  return new Map<string, LotStatus>(
    [...newest].map(([subjectId, job]) => [
      subjectId,
      { step: workStep(job), text: job.latest_status!.text, state: job.session_state! },
    ]),
  )
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

  const sessions: SourceSession[] = snapshot.jobs.flatMap((job) =>
    job.session_state
      ? [
          {
            jobId: job.id,
            step: workStep(job),
            subject: subject(job),
            lotId:
              job.subject_id !== null && activeLotIds.has(job.subject_id) ? job.subject_id : null,
            state: job.session_state,
            status: job.latest_status?.text ?? null,
          },
        ]
      : [],
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
    sessions,
    lead: sessions.find((session) => session.jobId === examineLead(snapshot)?.id) ?? null,
    jobsOn,
  }
}
