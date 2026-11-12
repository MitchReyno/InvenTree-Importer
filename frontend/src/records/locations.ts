import type { UseQueryResult } from '@tanstack/react-query'
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

/** Where the existing-values read stands, for values only it can give. */
export type ExistingRead = {
  data: RecordExistingValuesDto | undefined
  /** The read failed or is paused, so values it would give are unavailable rather than unknown. */
  failed: boolean
  /** The read is in flight with nothing to show yet. */
  pending: boolean
}

/** The existing-values query as an `ExistingRead`; without one, nothing is read. */
export function existingRead(
  query: UseQueryResult<RecordExistingValuesDto> | undefined,
): ExistingRead {
  if (!query) {
    return { data: undefined, failed: false, pending: false }
  }

  return {
    data: query.data,
    failed: query.isError || query.fetchStatus === 'paused',
    pending: query.isPending && query.fetchStatus === 'fetching',
  }
}

export type LocationPath =
  | { kind: 'known'; path: string }
  | { kind: 'reading' }
  | { kind: 'unavailable' }
  | { kind: 'unknown' }

/** InvenTree's path for a location it holds, as the existing-values read gives it. */
function readPath(key: string, read: ExistingRead): LocationPath {
  const entry = read.data?.records.find((item) => item.key === key)
  if (entry?.status === 'found') {
    const path = entry.fields.find((field) => field.name === 'path')?.value

    return path ? { kind: 'known', path } : { kind: 'unknown' }
  }
  if (entry?.status === 'unavailable' || (!entry && read.failed)) {
    return { kind: 'unavailable' }
  }
  if (!entry && read.pending) {
    return { kind: 'reading' }
  }

  return { kind: 'unknown' }
}

/**
 * The location's path: InvenTree's own for an existing location, or, for the new location drafted
 * as the batch default, its parent's InvenTree path and its name. A parent that is invalid, or
 * whose path the read doesn't give, leaves the path unknown.
 */
export function locationPath(
  batch: CaptureSnapshotDto,
  record: BatchRecordDto,
  read: ExistingRead,
): LocationPath {
  if (record.mapped) {
    return readPath(record.key, read)
  }
  if (!record.key.startsWith(DRAFT_PREFIX) || record.decision) {
    return { kind: 'unknown' }
  }
  const draft = defaultLocationDraft(batch)
  if (!draft || `${DRAFT_PREFIX}${draft.draftId}` !== record.key || !draft.parentValid) {
    return { kind: 'unknown' }
  }
  const parent = draft.value.parent
  if (!parent) {
    return { kind: 'known', path: draft.value.name }
  }
  const parentPath = readPath(`location:${parent.pk}`, read)

  return parentPath.kind === 'known'
    ? { kind: 'known', path: `${parentPath.path} › ${draft.value.name}` }
    : parentPath
}

const UNAVAILABLE = 'Path unavailable: InvenTree couldn’t be read'

/** The path in words; a list leaves out a path still being read. */
export function locationPathText(path: LocationPath): string {
  if (path.kind === 'known') {
    return path.path
  }
  if (path.kind === 'unavailable') {
    return UNAVAILABLE
  }

  return path.kind === 'reading' ? 'Reading…' : 'Not known'
}

/**
 * A lot's stock quantity in words, from the projection's stock item record, as approval reads it:
 * an Examine estimate stays an estimate, and a missing count says it needs a decision.
 */
export function stockQuantityText(records: readonly BatchRecordDto[] | undefined, lotId: string) {
  const stock = records?.find((record) => record.key === `stock_item:${lotId}`)
  const quantity = stock?.fields.find((field) => field.name === 'quantity')
  if (!stock || !quantity) {
    return 'Not known'
  }
  if (quantity.value === null) {
    return stock.decision ? 'Quantity needs a decision' : 'Not known'
  }
  if (quantity.origin.kind === 'estimate') {
    return `About ${quantity.value} pcs · Examine’s estimate, not yet accepted`
  }

  return `${quantity.value} pcs`
}
