import type { MediaEditDto, MediaReceiptDto, MediaSnapshotDto } from '@invimport/contracts'

export interface MediaClient {
  snapshot: (batchId: string) => Promise<MediaSnapshotDto>
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

export type EditMedia = (change: MediaEditDto['change'], revision?: string) => Promise<boolean>
