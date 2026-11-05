import type { CaptureSnapshotDto, OperatorReviewDto } from '@invimport/contracts'
import { batchHref } from '../navigation/batch-route'

export type ProposedLotState = 'added' | 'ready' | 'to_review' | 'changed' | 'blocked'

export type ProposedLot = { id: string; label: string; state: ProposedLotState; href: string }

function lotState(review: OperatorReviewDto | undefined, lotId: string): ProposedLotState {
  const lot = review?.lots.find((item) => item.lot_id === lotId)
  if (!lot) {
    return 'to_review'
  }
  if (lot.approved) {
    return 'added'
  }
  if (lot.issues.some((issue) => issue.severity === 'blocking' && !issue.disposition)) {
    return 'blocked'
  }
  if (lot.review_state === 'changed_after_review') {
    return 'changed'
  }

  return lot.review_state === 'reviewed' ? 'ready' : 'to_review'
}

/**
 * The batch's active lots for the Capture glance. Processing's adapter takes this over when
 * agent sessions supply live lots and status lines.
 */
export function proposedLots(
  batch: CaptureSnapshotDto,
  review: OperatorReviewDto | undefined,
  retiredLotIds: ReadonlySet<string>,
): ProposedLot[] {
  return batch.lots
    .filter((lot) => !retiredLotIds.has(lot.id))
    .map((lot) => ({
      id: lot.id,
      label: lot.label,
      state: lotState(review, lot.id),
      href: batchHref(batch.id, { tab: 'review', view: 'lots', lotId: lot.id }),
    }))
}
