import { inArray } from 'drizzle-orm'
import type { PoolClient } from 'pg'
import {
  MAX_HEADER_BATCH_STEPS,
  type HeaderWorkDto,
  type ProcessingActivityDto,
} from '@invimport/contracts'
import { executeDatabaseQuery, queryDatabase } from '../db/database.ts'
import type { ProcessingConfig } from '../processing/attempts.ts'
import { processingSnapshot } from '../processing/read.ts'
import { processingJobs } from '../processing/schema.ts'
import { captureInTransaction } from '../capture/repository.ts'
import { countSteps } from '../processing/steps.ts'

type BatchSteps = NonNullable<HeaderWorkDto['batch_steps']>

export async function processingHeaderWork(
  client: PoolClient,
  config: ProcessingConfig,
  activity: ProcessingActivityDto,
  batchId?: string,
): Promise<{ work: HeaderWorkDto['work']; batchSteps: BatchSteps }> {
  const work: HeaderWorkDto['work'] = []
  const batchSteps: BatchSteps = []

  const currentJobs = async (id: string) => {
    const capture = await captureInTransaction(client, config, id)
    const current = await processingSnapshot(client, config, capture.snapshot)
    batchSteps.push({ batch_id: id, steps: countSteps(current.jobs) })
    return current.jobs
  }

  if (batchId) {
    for (const job of await currentJobs(batchId)) {
      const active = activity.jobs.find((candidate) => candidate.attempt_id === job.attempt_id)
      work.push({
        kind: 'processing',
        id: job.id,
        batch_id: batchId,
        attempt_id: job.attempt_id,
        stage: job.stage,
        state: job.state,
        input_current: active?.input_current ?? null,
        occupies_lane: active?.occupies_lane ?? false,
        blocked_code: job.blocked_code ?? null,
        steps: [{ stage: job.stage, state: job.state }],
        steps_complete: false,
      })
    }
  }
  const remaining = activity.jobs.filter(
    (job) =>
      !work.some((entry) => entry.kind === 'processing' && entry.attempt_id === job.attempt_id),
  )
  const stages = remaining.length
    ? await executeDatabaseQuery(
        queryDatabase(client)
          .select({ id: processingJobs.id, stage: processingJobs.stage })
          .from(processingJobs)
          .where(
            inArray(
              processingJobs.id,
              remaining.map((job) => job.job_id),
            ),
          ),
      )
    : []
  const stageById = new Map(stages.map((job) => [job.id, job.stage]))
  for (const job of remaining) {
    const stage = stageById.get(job.job_id)
    if (!stage) {
      throw new Error('header_job_stage_missing')
    }
    work.push({
      kind: 'processing',
      id: job.job_id,
      batch_id: job.batch_id,
      attempt_id: job.attempt_id,
      stage,
      state: job.state,
      input_current: job.input_current,
      occupies_lane: job.occupies_lane,
      blocked_code: job.blocked_code ?? null,
      steps: [{ stage, state: job.state }],
      steps_complete: false,
    })
  }
  // Counts come from each batch's current snapshot, as the attention read's do, so a few suffice.
  const others = [...new Set(remaining.map((job) => job.batch_id))]
    .filter((id) => id !== batchId)
    .sort()
  for (const id of others.slice(0, MAX_HEADER_BATCH_STEPS - batchSteps.length)) {
    await currentJobs(id)
  }
  return { work, batchSteps }
}
