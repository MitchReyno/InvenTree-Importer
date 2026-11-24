/** The redesigned Processing tab's steps, in plan order. */
export const STEPS = ['examine', 'research', 'images', 'inventory'] as const

export type Step = (typeof STEPS)[number]

/** Reading and Identifying are the Examine step on the redesigned Processing tab. */
export const STEP_BY_STAGE: Record<string, Step> = {
  reading: 'examine',
  identifying: 'examine',
  examine: 'examine',
  research: 'research',
  images: 'images',
  inventory: 'inventory',
}

export type StepJobs = { jobs: number; ready: number; running: number }

/**
 * The jobs a step counts: the batch-level Examine lead job and those of active lots and Parts. A
 * retired lot's job is always superseded and can never run again, so it stays history only.
 */
export function activeSubjectJobs<Job extends { subject_id: string | null }>(
  jobs: readonly Job[],
  retiredLotIds: ReadonlySet<string>,
): Job[] {
  return jobs.filter((job) => job.subject_id === null || !retiredLotIds.has(job.subject_id))
}

/** The retired lots of a capture snapshot, for `activeSubjectJobs`. */
export function retiredLotIds(capture: { lots: readonly { id: string; retired?: true }[] }) {
  return new Set(capture.lots.filter((lot) => lot.retired).map((lot) => lot.id))
}

/**
 * Each step's job count and how many of them are ready or running, over `activeSubjectJobs`. A job
 * is one subject's step and carries its current attempt's state, so an active subject's failed,
 * superseded or cancelled job is work not done and still counts.
 */
export function countSteps(jobs: readonly { stage: string; state: string }[]) {
  return Object.fromEntries(
    STEPS.map((step) => {
      const own = jobs.filter((job) => STEP_BY_STAGE[job.stage] === step)
      return [
        step,
        {
          jobs: own.length,
          ready: own.filter((job) => job.state === 'ready').length,
          running: own.filter((job) => job.state === 'running').length,
        },
      ]
    }),
  ) as Record<Step, StepJobs>
}

/** Jobs waiting for the operator: an answer, or a sign-in only they can give. */
const WAITING_FOR_OPERATOR = new Set(['waiting_for_user', 'waiting_for_login'])

/** Jobs waiting for a slot to run in. */
const QUEUED = new Set(['queued', 'waiting_for_capacity'])

const FAILED = new Set(['failed', 'interrupted'])

/**
 * A step's jobs by state, its open questions, and `ready_lots`: the live lots with a ready job at
 * the step. Part jobs count among the jobs but never add to `ready_lots`.
 */
export type StageWork = StepJobs & {
  waiting: number
  queued: number
  questions: number
  failed: number
  ready_lots: number
}

type StageJob = {
  subject_id: string | null
  stage: string
  state: string
  questions: readonly { state: string }[]
}

/**
 * Each step's work over `activeSubjectJobs`, for the header and attention reads. A retired lot's
 * job is always superseded, so leaving it out drops no failure or open question.
 */
export function countStageWork(jobs: readonly StageJob[], liveLotIds: ReadonlySet<string>) {
  const counted = countSteps(jobs)

  const stage = (step: Step): StageWork => {
    const own = jobs.filter((job) => STEP_BY_STAGE[job.stage] === step)

    const count = (states: ReadonlySet<string>) => own.filter((job) => states.has(job.state)).length

    const readyLots = new Set(
      own
        .filter((job) => job.state === 'ready')
        .map((job) => job.subject_id)
        .filter((subject) => subject !== null && liveLotIds.has(subject)),
    )

    return {
      ...counted[step],
      waiting: count(WAITING_FOR_OPERATOR),
      queued: count(QUEUED),
      questions: own.flatMap((job) => job.questions).filter((question) => question.state === 'open')
        .length,
      failed: count(FAILED),
      ready_lots: readyLots.size,
    }
  }

  return Object.fromEntries(STEPS.map((step) => [step, stage(step)])) as Record<Step, StageWork>
}

/** The live lots of a capture snapshot: every lot not retired. */
export function liveLotIds(capture: { lots: readonly { id: string; retired?: true }[] }) {
  return new Set(capture.lots.filter((lot) => !lot.retired).map((lot) => lot.id))
}
