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

/** Attempts that will not finish: replaced, cancelled or failed. A failure is reported on its own. */
const ENDED_STATES = new Set(['superseded', 'cancelled', 'failed'])

/**
 * Each step's job count and how many of them are ready or running. Ended attempts are left out, so
 * the count is the work still to finish and a step can reach done.
 */
export function countSteps(jobs: readonly { stage: string; state: string }[]) {
  return Object.fromEntries(
    STEPS.map((step) => {
      const own = jobs.filter(
        (job) => STEP_BY_STAGE[job.stage] === step && !ENDED_STATES.has(job.state),
      )
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
