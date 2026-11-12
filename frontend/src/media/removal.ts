import type {
  CaptureSnapshotDto,
  MediaEvidenceDto,
  MediaRemovalImpactDto,
} from '@invimport/contracts'

/** What a delete changes, from the item's own fields or the combined read for several. */
export type RemovalImpact = Pick<
  MediaRemovalImpactDto,
  'lot_ids' | 'sole_evidence_lot_ids' | 'selected_attachment_of'
>

const approvalDate = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })

const KEPT_AS_RECORD = 'It stays as the record of what was added.'

/** Why an item can't be deleted, or null when it can. */
export function approvalRefusal(item: Pick<MediaEvidenceDto, 'pinned_by'>) {
  if (!item.pinned_by) {
    return null
  }
  const date = approvalDate.format(new Date(item.pinned_by.approved_at))

  return `Used by the approval on ${date}. ${KEPT_AS_RECORD}`
}

/** Why a selection can't be deleted together: the files an approval used, by name. */
export function bulkApprovalRefusal(
  items: MediaEvidenceDto[],
  names: (item: MediaEvidenceDto) => string,
) {
  const pinned = items.filter((item) => item.pinned_by)
  if (!pinned.length) {
    return null
  }
  const list = joinNames(pinned.map(names))
  const verb = pinned.length === 1 ? 'was' : 'were'

  return `${list} ${verb} used by an approval. ${KEPT_AS_RECORD}`
}

/** One item's impact, from the fields the operator's snapshot gives it. */
export function itemImpact(item: MediaEvidenceDto): RemovalImpact {
  return {
    lot_ids: item.lot_ids ?? [],
    sole_evidence_lot_ids: item.sole_evidence_lot_ids ?? [],
    selected_attachment_of: item.selected_attachment_of ?? [],
  }
}

/** A lot's or Part's label; an id the capture read doesn't hold says so rather than vanishing. */
export function subjectLabel(batch: CaptureSnapshotDto, subjectId: string) {
  const subject = [...batch.lots, ...batch.parts].find((item) => item.id === subjectId)
  return subject?.label ?? 'A lot not in this view'
}

export function attachmentLabel(
  batch: CaptureSnapshotDto,
  selection: RemovalImpact['selected_attachment_of'][number],
) {
  const destination =
    selection.destination === 'part_attachment' ? 'Part attachment' : 'Lot attachment'
  return `${subjectLabel(batch, selection.subject_id)} · ${destination}`
}

/** "A", "A and B", "A, B and C". */
export function joinNames(names: string[]) {
  if (names.length < 2) {
    return names.join('')
  }
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}
