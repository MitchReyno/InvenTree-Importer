import type {
  MediaEditDto,
  MediaReceiptDto,
  MediaRemovalImpactDto,
  MediaSnapshotDto,
} from '@invimport/contracts'

export interface MediaClient {
  snapshot: (batchId: string) => Promise<MediaSnapshotDto>
  /** What removing these present items together changes, for a bulk delete's confirmation. */
  removalImpact: (batchId: string, evidenceIds: readonly string[]) => Promise<MediaRemovalImpactDto>
  edit: (batchId: string, input: MediaEditDto, key: string) => Promise<MediaSnapshotDto>
  upload: (
    batchId: string,
    revision: string,
    label: string,
    bytes: Blob,
    key: string,
  ) => Promise<MediaReceiptDto>
}

export function mediaResource(batchId: string, kind: 'versions' | 'previews', resourceId: string) {
  return `/api/v1/batches/${encodeURIComponent(batchId)}/media/${kind}/${encodeURIComponent(resourceId)}`
}

/** The region an evidence observation covers, cut from its page preview. */
export function observationCrop(batchId: string, observationId: string) {
  return `/api/v1/batches/${encodeURIComponent(batchId)}/media/observations/${encodeURIComponent(observationId)}/crop`
}

/** A session's photo view recut from its page, as the session's photo-view crop route serves it. */
export function photoViewCrop(batchId: string, jobId: string, attemptId: string, seq: string) {
  const job = `${encodeURIComponent(batchId)}/processing/sessions/${encodeURIComponent(jobId)}`
  return `/api/v1/batches/${job}/photo-views/${encodeURIComponent(attemptId)}/${encodeURIComponent(seq)}/crop`
}

/** A rendered question picture: the larger `view` or its `thumb`. */
export type QuestionFigureSize = 'view' | 'thumb'

/** A question's picture as the figure route serves it; `index` counts from 1, in the agent's order. */
export function questionFigureImage(
  batchId: string,
  jobId: string,
  questionId: string,
  index: number,
  size: QuestionFigureSize,
) {
  const job = `${encodeURIComponent(batchId)}/processing/sessions/${encodeURIComponent(jobId)}`
  return `/api/v1/batches/${job}/questions/${encodeURIComponent(questionId)}/figures/${index}/${size}`
}

/** `onConfirmed` runs once the change is confirmed, whether by this request or its exact retry. */
export type EditMedia = (
  change: MediaEditDto['change'],
  revision?: string,
  onConfirmed?: () => void,
) => Promise<boolean>
