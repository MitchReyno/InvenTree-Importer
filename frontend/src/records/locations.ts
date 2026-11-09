import {
  defaultLocationDraft,
  type BatchRecordDto,
  type CaptureSnapshotDto,
  type RecordExistingValuesDto,
} from '@invimport/contracts'

/** Why the batch's stock goes to a location: the batch default, lots that override it, or neither yet. */
export type LocationUse =
  { kind: 'default' } | { kind: 'override'; lots: number } | { kind: 'decision' }

const DRAFT_PREFIX = 'location:draft:'

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

/** The record key of the batch default location: an existing one, or the new one drafted for it. */
export function defaultLocationKey(batch: CaptureSnapshotDto): string | null {
  const fallback = batch.defaults.location
  if (fallback.mode === 'set') {
    return `location:${fallback.value.pk}`
  }
  const draft = defaultLocationDraft(batch)

  return draft ? `${DRAFT_PREFIX}${draft.draftId}` : null
}

export function locationUse(batch: CaptureSnapshotDto, record: BatchRecordDto): LocationUse {
  if (record.decision) {
    return { kind: 'decision' }
  }
  if (record.key === defaultLocationKey(batch)) {
    return { kind: 'default' }
  }

  return { kind: 'override', lots: record.lot_ids.length }
}

export function locationUseText(use: LocationUse) {
  if (use.kind === 'default') {
    return 'batch default'
  }
  if (use.kind === 'decision') {
    return 'needs a decision'
  }

  return `from ${plural(use.lots, 'lot override')}`
}

/** Each active lot becomes one stock item. */
export function stockCountText(record: BatchRecordDto) {
  return plural(record.lot_ids.length, 'stock item')
}

/**
 * The location's path: InvenTree's own for an existing location once it is read, or the parent
 * chosen in Capture for the new one. Undefined while it is unknown.
 */
export function locationPath(
  batch: CaptureSnapshotDto,
  record: BatchRecordDto,
  existing: RecordExistingValuesDto | undefined,
): string | undefined {
  if (record.key.startsWith(DRAFT_PREFIX)) {
    const draftId = record.key.slice(DRAFT_PREFIX.length)
    const draft = batch.reference_drafts?.find(
      (item) => item.draft_id === draftId && item.kind === 'location',
    )
    if (!draft || draft.kind !== 'location') {
      return undefined
    }
    const parent = draft.value.parent
    const parentLabel = parent
      ? batch.observations.find((item) => item.id === parent.observation_id)?.label
      : undefined

    return parentLabel ? `${parentLabel} › ${draft.value.name}` : draft.value.name
  }
  const entry = existing?.records.find((item) => item.key === record.key)
  if (entry?.status !== 'found') {
    return undefined
  }

  return entry.fields.find((field) => field.name === 'path')?.value ?? undefined
}

/** A lot's count as approval reads it: its own, else the batch default; null when unknown. */
export function lotQuantity(batch: CaptureSnapshotDto, lotId: string): string | null {
  const lot = batch.lots.find((item) => item.id === lotId)
  if (!lot) {
    return null
  }
  const resolved = lot.quantity.mode === 'inherit' ? batch.defaults.quantity : lot.quantity

  return resolved.mode === 'set' ? resolved.value : null
}
