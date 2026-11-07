import type { CaptureSnapshotDto, OperatorReviewDto } from '@invimport/contracts'
import { batchHref } from '../navigation/batch-route'
import { coverSizes, observationImage, type ImageAttributes } from '../media/images'

export type ProposedLotState = 'approved' | 'ready' | 'to_review' | 'changed' | 'blocked'

export type ProposedLot = {
  id: string
  label: string
  state: ProposedLotState
  href: string
  /** Who formed the lot: the Examine lead session, or the operator. */
  origin?: 'agent' | 'operator'
  /** An AI lot the operator has changed; the lead session now only suggests for it. */
  edited?: boolean
  /** Crop URLs of the lot's pixel observations. */
  /** Observation crops, sized for the glance's 40 px cover thumbnails. */
  crops?: ImageAttributes[]
  /** Observations the lead session suggested for this lot, awaiting the operator. */
  suggestions?: number
  /** The lot's latest agent status line, as "Step · line". */
  status?: string
}

function lotState(review: OperatorReviewDto | undefined, lotId: string): ProposedLotState {
  const lot = review?.lots.find((item) => item.lot_id === lotId)
  if (!lot) {
    return 'to_review'
  }
  if (lot.approved) {
    return 'approved'
  }
  if (lot.issues.some((issue) => issue.severity === 'blocking' && !issue.disposition)) {
    return 'blocked'
  }
  if (lot.review_state === 'changed_after_review') {
    return 'changed'
  }

  return lot.review_state === 'reviewed' ? 'ready' : 'to_review'
}

/** The batch's active lots for the Capture glance, including the lead session's live lots. */
export function proposedLots(
  batch: CaptureSnapshotDto,
  review: OperatorReviewDto | undefined,
  retiredLotIds: ReadonlySet<string>,
): ProposedLot[] {
  return batch.lots
    .filter((lot) => !lot.retired && !retiredLotIds.has(lot.id))
    .map((lot) => {
      const members = new Set(lot.evidence_observation_ids ?? [])
      const observations = batch.evidence_observations ?? []
      const crops = observations
        .filter(
          (observation) => members.has(observation.id) && observation.region.kind === 'pixels',
        )
        .map((observation) =>
          observation.region.kind === 'pixels'
            ? observationImage(
                batch.id,
                { ...observation, region: observation.region },
                'thumbnail',
                coverSizes({ width: 40, height: 40 }, observation.region),
              )
            : null,
        )
        .filter((image): image is ImageAttributes => image !== null)
      const suggestions = observations.filter((observation) =>
        observation.suggested_lot_ids.includes(lot.id),
      ).length
      const base = {
        id: lot.id,
        label: lot.label,
        state: lotState(review, lot.id),
        href: batchHref(batch.id, { tab: 'review', view: 'lots', lotId: lot.id }),
      }
      // Operator lots without observations keep their earlier shape.
      if (lot.origin !== 'agent' && !crops.length && !suggestions) {
        return base
      }
      return {
        ...base,
        origin: lot.origin === 'agent' ? ('agent' as const) : ('operator' as const),
        edited: lot.operator_edited === true,
        crops,
        suggestions,
      }
    })
}
