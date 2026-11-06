import type { CaptureSnapshotDto, MediaSnapshotDto } from '@invimport/contracts'

/** A direct link can be unlinked here; a link through the lot's Part belongs to the Part. */
export type MapLink = { lotId: string; via: 'direct' | 'part' }

export type MapFile = {
  id: string
  label: string
  lotIds: string[]
  links: MapLink[]
  unused: boolean
}
export type MapLot = { id: string; label: string; fileIds: string[]; singleSource: boolean }

/**
 * How the evidence became lots, at file level: a file supports a lot when it is linked to the lot
 * or to the lot's Part. Region-level links wait for observations.
 */
export function reviewMap(
  batch: CaptureSnapshotDto,
  evidence: MediaSnapshotDto['evidence'],
  retiredLotIds: ReadonlySet<string>,
) {
  const lots = batch.lots.filter((lot) => !retiredLotIds.has(lot.id))

  const supports = (file: MediaSnapshotDto['evidence'][number], lot: (typeof lots)[number]) =>
    file.linked_subject_ids.includes(lot.id) ||
    (lot.part_subject_id !== null && file.linked_subject_ids.includes(lot.part_subject_id))

  const files: MapFile[] = evidence.map((file) => {
    const links: MapLink[] = lots
      .filter((lot) => supports(file, lot))
      .map((lot) => ({
        lotId: lot.id,
        via: file.linked_subject_ids.includes(lot.id) ? 'direct' : 'part',
      }))
    const lotIds = links.map((link) => link.lotId)
    return { id: file.id, label: file.label, lotIds, links, unused: lotIds.length === 0 }
  })
  const mapLots: MapLot[] = lots.map((lot) => {
    const fileIds = evidence.filter((file) => supports(file, lot)).map((file) => file.id)
    return { id: lot.id, label: lot.label, fileIds, singleSource: fileIds.length === 1 }
  })

  return { files, lots: mapLots }
}
