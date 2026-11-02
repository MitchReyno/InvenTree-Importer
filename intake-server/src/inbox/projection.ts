import type { Pool } from 'pg'
import { validate, type CaptureListQueryDto, type InboxListDto } from '@invimport/contracts'
import { captureInTransaction, listCaptureBatches } from '../capture/repository.ts'
import { transaction } from '../db/database.ts'
import { operatorReview } from '../operator-review/projection.ts'
import { inboxProcessing } from '../processing/read.ts'
import { prepareMediaTransaction } from '../media/transaction.ts'
import { inboxThumbnail } from '../media/read.ts'
import { latestInboxRound } from '../review/repository.ts'
import type { ManualConfig } from '../review/authority.ts'

const INBOX_PAGE_SIZE = 10

/** One bounded observation, with all module projections sharing a read-only snapshot. */
export async function inboxProjection(
  pool: Pool,
  config: ManualConfig,
  query: CaptureListQueryDto,
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
      const processing = await inboxProcessing(client, capture.snapshot)
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
        },
      })
    }
    const result = { batches, truncated: listed.truncated }
    validate('InboxList', result)
    return result
  })
}
