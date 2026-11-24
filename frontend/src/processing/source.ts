import {
  oldestQuestionFirst,
  questionView,
  type AgentSessionDto,
  type ProcessingSnapshotDto,
  type SessionFailureSummaryDto,
} from '@invimport/contracts'
import { earlierFromList, type EarlierAttempt } from '#/agents/session-list'
import { assumptionLine, questionKindLabel, stepKinds } from './question-summary'
import { processingStepFor } from '#/navigation/batch-route'

type Job = ProcessingSnapshotDto['jobs'][number]

export type WorkStep = 'examine' | 'research' | 'images' | 'inventory'

export const WORK_STEPS: { step: WorkStep; label: string }[] = [
  { step: 'examine', label: 'Examine' },
  { step: 'research', label: 'Research' },
  { step: 'images', label: 'Images' },
  { step: 'inventory', label: 'Inventory' },
]

/**
 * Retained step state in counts; Processing never reduces it to one percentage. `waiting` jobs
 * wait for the operator and `queued` ones for a slot, as the header read counts them; `readyLots`
 * are the live lots with a ready job at the step, of the batch's `lots`.
 */
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
  readyLots: number
  lots: number
}

export type SourceQuestion = {
  id: string
  jobId: string
  step: WorkStep
  subject: string
  /** A stepped question's title, or a one-step question's prompt. */
  title: string
  /** "3 steps", "choose one of 2", "a number" or "in words". */
  kind: string
  /** The agent's assumptions, one per step where it recorded one. */
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
  /** From the session list only: the current attempt's failure and the attempts before it. */
  failure?: SessionFailureSummaryDto
  earlier?: { count: number; attempts: readonly EarlierAttempt[] }
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
  /** The batch's agents are paused, so queued sessions read Paused. */
  paused?: boolean
}

const WAITING = new Set(['waiting_for_user', 'waiting_for_login'])
const QUEUED = new Set(['queued', 'waiting_for_capacity'])
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
  /** Their jobs stay listed as history but leave the step counts, so a step can reach done. */
  retiredLotIds: ReadonlySet<string> = new Set(),
): ProcessingSource {
  const subject = (job: Job) =>
    job.subject_id === null ? 'Whole batch' : (subjects.get(job.subject_id) ?? 'Unknown subject')

  const jobsOn = (step: WorkStep) => snapshot.jobs.filter((job) => workStep(job) === step)

  // Oldest first across jobs, as Needs you lists them.
  const questions = snapshot.jobs
    .flatMap((job) =>
      job.questions
        .filter((question) => question.state === 'open')
        .map((question) => ({ job, question })),
    )
    .sort((a, b) => oldestQuestionFirst(a.question, b.question))
    .map(({ job, question }) => {
      // The Examine lead session can ask about the whole batch.
      const about = question.subject_id
      const view = questionView(question)
      return {
        id: question.id,
        jobId: job.id,
        step: workStep(job),
        subject: about === null ? 'Whole batch' : (subjects.get(about) ?? subject(job)),
        title: view.title,
        kind: questionKindLabel(stepKinds(view.steps)),
        assumption: assumptionLine(view.steps.map((step) => step.assumption)),
        lotId: about !== null && activeLotIds.has(about) ? about : null,
      }
    })

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
      const jobs = jobsOn(step).filter(
        (job) => job.subject_id === null || !retiredLotIds.has(job.subject_id),
      )

      const count = (match: (job: Job) => boolean) => jobs.filter(match).length

      const readyLots = new Set(
        jobs
          .filter((job) => job.state === 'ready')
          .map((job) => job.subject_id)
          .filter((subject) => subject !== null && activeLotIds.has(subject)),
      )

      return {
        step,
        label,
        jobs: jobs.length,
        queued: count((job) => QUEUED.has(job.state)),
        running: count((job) => job.state === 'running'),
        waiting: count((job) => WAITING.has(job.state)),
        ready: count((job) => job.state === 'ready'),
        failed: count((job) => FAILED.has(job.state)),
        questions: questions.filter((question) => question.step === step).length,
        readyLots: readyLots.size,
        lots: activeLotIds.size,
      }
    }),
    questions,
    sessions,
    lead: sessions.find((session) => session.jobId === examineLead(snapshot)?.id) ?? null,
    jobsOn,
    paused: snapshot.paused === true,
  }
}

/** The batch's session list as Processing's session rows, each with its earlier attempts. */
export function listedSessions(
  rows: readonly AgentSessionDto[],
  subjects: ReadonlyMap<string, string>,
  activeLotIds: ReadonlySet<string>,
): SourceSession[] {
  // An earlier profile's attempt has no session; the snapshot doesn't list it as one either.
  return rows.flatMap((row) => {
    if (row.session_state === null) {
      return []
    }
    const step = processingStepFor(row.stage)
    return {
      jobId: row.job_id,
      step: step === 'overview' ? 'examine' : step,
      subject:
        row.subject_id === null
          ? 'Whole batch'
          : (subjects.get(row.subject_id) ?? 'Unknown subject'),
      lotId: row.subject_id !== null && activeLotIds.has(row.subject_id) ? row.subject_id : null,
      state: row.session_state,
      status: row.latest_status?.text ?? null,
      ...(row.failure ? { failure: row.failure } : {}),
      earlier: { count: row.earlier_attempt_count, attempts: earlierFromList(row) },
    }
  })
}
