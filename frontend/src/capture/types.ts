import type { CaptureEditDto, CaptureSnapshotDto, CaptureObservationDto } from '@invimport/contracts'

export type Snapshot = CaptureSnapshotDto
export type Quantity = Snapshot['lots'][number]['quantity']
export type Reference = Snapshot['lots'][number]['location']
export type CaptureWorkspaceProps = { batch: Snapshot; busy: boolean; edit: (change: CaptureEditDto['change']) => Promise<void>; observe: (model: 'part' | 'location', pk: string) => Promise<CaptureObservationDto | null> }
