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
