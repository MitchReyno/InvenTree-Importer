import type { PoolClient } from 'pg'
import type { CaptureEditDto, CaptureSnapshotDto } from '@invimport/contracts'
import type { CaptureBinding } from '../capture/model.ts'

/** The owning capture module implements this seam; processing never writes its SQL tables. */
export interface LockedCapture {
  snapshot: CaptureSnapshotDto
  streamId: string
  apply(input: CaptureEditDto): Promise<CaptureSnapshotDto>
  publish(): Promise<void>
}

export type LockCapture = (
  client: PoolClient,
  binding: CaptureBinding,
  batchId: string,
  expectedRevision: string,
) => Promise<LockedCapture>
