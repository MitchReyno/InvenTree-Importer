import type {
  OperatorReviewDto,
  CaptureEditDto,
  CaptureSnapshotDto,
  CaptureObservationDto,
} from '@invimport/contracts'

import type { MediaClient } from '../media/types'
import type { OperatorReviewClient } from '../operator/types'

export type Snapshot = CaptureSnapshotDto
export type Quantity = Snapshot['lots'][number]['quantity']
export type Reference = Snapshot['lots'][number]['location']
export type CaptureWorkspaceProps = {
  batch: Snapshot
  busy: boolean
  media?: MediaClient
  edit: (change: CaptureEditDto['change']) => Promise<void>
  observe: (model: 'part' | 'location', pk: string) => Promise<CaptureObservationDto | null>
  onDirtyChange?: (dirty: boolean) => void
  onProcessing?: () => void
  onStage?: (stage: 'capture' | 'review' | 'approve' | 'results') => void
  operatorReview?: OperatorReviewDto
  operator?: OperatorReviewClient
  reload?: () => Promise<void>
}
