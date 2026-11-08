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

/** Each step's job count and how many of them are ready or running. */
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
