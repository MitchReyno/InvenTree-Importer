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

/** `onConfirmed` runs once the change is confirmed, whether by this request or its exact retry. */
export type EditMedia = (
  change: MediaEditDto['change'],
  revision?: string,
  onConfirmed?: () => void,
) => Promise<boolean>
