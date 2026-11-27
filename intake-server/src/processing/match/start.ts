import type { PoolClient } from 'pg'
import type { CaptureSnapshotDto } from '@invimport/contracts'
import type { ProcessingConfig } from '../attempts.ts'
import { checkJobCapacity, queueJob } from '../jobs.ts'
import { lotStageOf, sealedMatchFor } from '../match-outcome.ts'
import { reservedMediaFor, type reserveProcessingMedia } from '../media.ts'
import { fail, type Stage } from '../model.ts'
import { matchGate } from './gate.ts'
import { pinsOf } from './queue.ts'
import { decodeIdentity, lockMatch } from './state.ts'

/**
 * Start for a `/7` batch: each requested stage of each lot is queued only when Match allows it,
 * in the mode its outcome sets and pinned to the identity Match searched. A lot Match hasn't
 * searched, or holds, starts nothing; Check again in the Match step searches it. Refused when
 * nothing at all could start. Caller holds the capture, media and lane locks.
 */
export async function startMatchedStages(
  client: PoolClient,
  config: ProcessingConfig,
  snapshot: CaptureSnapshotDto,
  subjectIds: readonly string[],
  stages: readonly Stage[],
  media: Awaited<ReturnType<typeof reserveProcessingMedia>>,
) {
  const queue: {
    lotId: string
    stage: Stage
    pins: string[]
    match: ReturnType<typeof sealedMatchFor>
  }[] = []
  for (const lotId of [...subjectIds].sort()) {
    const row = await lockMatch(client, lotId)
    if (!row) {
      continue
    }
    const pins = pinsOf(decodeIdentity(row))
    for (const stage of stages) {
      const lotStage = lotStageOf(stage)
      const gate = await matchGate(client, lotId, lotStage)
      if (!gate.allowed || !gate.outcome) {
        continue
      }
      queue.push({ lotId, stage, pins, match: sealedMatchFor(gate.outcome.outcome, lotStage) })
    }
  }
  if (!queue.length) {
    return fail('match_waiting', 409)
  }
  for (const lotId of new Set(queue.map((item) => item.lotId))) {
    await checkJobCapacity(
      client,
      snapshot.id,
      [lotId],
      queue.filter((item) => item.lotId === lotId).map((item) => item.stage),
    )
  }
  const jobIds: string[] = []
  const attemptIds: string[] = []
  for (const item of queue) {
    const attempt = await queueJob(
      client,
      config,
      snapshot,
      item.lotId,
      item.stage,
      [],
      reservedMediaFor(media, item.lotId),
      item.pins,
      { inputVersion: 'bench-intake-input/7', match: item.match },
    )
    jobIds.push(attempt.jobId)
    attemptIds.push(attempt.attemptId)
  }
  return { job_ids: jobIds, attempt_ids: attemptIds }
}
