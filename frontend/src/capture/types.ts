import type {
  OperatorReviewDto,
  CaptureEditDto,
  CaptureSnapshotDto,
  CaptureObservationDto,
  InventoryModelDto,
} from '@invimport/contracts'

import type { CaptureBatchSettingsChangeDto, MediaReceiptDto } from '@invimport/contracts'
import type { CatalogueClient } from '#/catalogue/types'

export type Snapshot = CaptureSnapshotDto
export type Quantity = Snapshot['lots'][number]['quantity']
export type Reference = Snapshot['lots'][number]['location']
/**
 * Resolves false when the change was not saved; the host shows why. `Batch` resolves the accepted
 * snapshot, so a follow-up command can use what the save created.
 */
export type CaptureEdit = (
  change: CaptureEditDto['change'],
) => Promise<CaptureSnapshotDto | boolean | void>
export type CaptureObserve = (
  model: InventoryModelDto,
  pk: string,
) => Promise<CaptureObservationDto | null>
export type CaptureWorkspaceProps = {
  batch: Snapshot
  busy: boolean
  onDirtyChange?: (dirty: boolean) => void
  operatorReview?: OperatorReviewDto
  settings?: SettingsPorts
}

/** Raw retained commands for the autosave owner; it supplies revisions and delivery keys. */
export type SettingsPorts = {
  connected: boolean
  save: (change: CaptureBatchSettingsChangeDto, revision: string, key: string) => Promise<Snapshot>
  /** Adopts an acknowledged or freshly read snapshot as edit authority without remounting. */
  accept: (snapshot: Snapshot) => void
  read: () => Promise<Snapshot>
  instruct?: (text: string, revision: string, key: string) => Promise<OperatorReviewDto>
  uploadLogo?: (
    file: Blob,
    label: string,
    revision: string,
    key: string,
  ) => Promise<MediaReceiptDto>
  catalogue?: CatalogueClient
}
