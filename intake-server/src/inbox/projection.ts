import type { Pool } from 'pg'
import {
  possibleDuplicates,
  validate,
  type CaptureListQueryDto,
  type InboxListDto,
} from '@invimport/contracts'
import { captureInTransaction, listCaptureBatches } from '#/capture/repository.ts'
import { transaction } from '#/db/database.ts'
import { operatorReview } from '#/operator-review/projection.ts'
import type { ProcessingConfig } from '#/processing/attempts.ts'
import { inboxProcessing } from '#/processing/read.ts'
import { prepareMediaTransaction } from '#/media/transaction.ts'
import { inboxEvidenceCounts, inboxThumbnail } from '#/media/read.ts'
import { latestInboxRound } from '#/review/repository.ts'
import type { ManualConfig } from '#/review/authority.ts'

const INBOX_PAGE_SIZE = 10

/** One bounded observation, with all module projections sharing a read-only snapshot. */
export async function inboxProjection(
  pool: Pool,
  config: ManualConfig,
  query: CaptureListQueryDto,
  processingConfig: ProcessingConfig,
): Promise<InboxListDto> {
  return transaction(pool, async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
    await prepareMediaTransaction(client)
    const listed = await listCaptureBatches(client, config, query, INBOX_PAGE_SIZE)
    const batches: InboxListDto['batches'] = []
    for (const batch of listed.batches) {
      const capture = await captureInTransaction(client, config, batch.id)
      const review = await operatorReview(client, config, batch.id)
      const pending = review.lots.filter((lot) => !lot.approved)
      const blocked = pending.filter((lot) =>
        lot.issues.some((issue) => issue.severity === 'blocking' || !issue.disposition),
      )
      const ready = pending.filter(
        (lot) => lot.review_state === 'reviewed' && !blocked.includes(lot),
      )
      const processing = await inboxProcessing(client, processingConfig, capture.snapshot)
      batches.push({
        ...batch,
        workflow: {
          lots: review.lots.length,
          ready: ready.length,
          needs_review: pending.filter((lot) => lot.review_state !== 'reviewed').length,
          blocked: blocked.length,
          approved: review.lots.filter((lot) => lot.approved).length,
          ...processing,
          latest_round: await latestInboxRound(client, config, batch.id),
          thumbnail: config.mediaEnabled ? await inboxThumbnail(client, batch.id) : null,
          ...(config.mediaEnabled ? { evidence: await inboxEvidenceCounts(client, batch.id) } : {}),
          possible_duplicates: possibleDuplicates(capture.snapshot.evidence_observations ?? []),
        },
      })
    }
    const result = { batches, truncated: listed.truncated }
    validate('InboxList', result)
    return result
  })
}
