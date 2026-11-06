import type { CaptureSnapshotDto, MediaSnapshotDto } from '@invimport/contracts'
import { evidenceDisplayNames } from '../media/identity-labels'

/**
 * A direct link can be unlinked here. A link through the lot's Part belongs to the Part, and one
 * through an earlier lot it was split or merged from belongs to that lot's history.
 */
export type MapLink = { lotId: string; via: 'direct' | 'part' | 'earlier' }

/** Matches the server's lineage walk, which also stops at this depth. */
const MAX_LINEAGE_DEPTH = 100

function ancestors(predecessors: ReadonlyMap<string, readonly string[]>, lotId: string) {
  const found = new Set<string>()
  let frontier = predecessors.get(lotId) ?? []
  for (let depth = 0; frontier.length && depth < MAX_LINEAGE_DEPTH; depth += 1) {
    const next: string[] = []
    for (const id of frontier) {
      if (!found.has(id)) {
        found.add(id)
        next.push(...(predecessors.get(id) ?? []))
      }
    }
    frontier = next
  }
  found.delete(lotId)
  return found
}

/** A region of a file that an observation records, and the lot it supports. */
export type MapRegion = { id: string; label: string; lotId: string | null }

export type MapFile = {
  id: string
  label: string
  /** Lots the file supports, through a file link or one of its regions. */
  lotIds: string[]
  /** File-level links, which the Map can unlink. */
  links: MapLink[]
  /** Regions observations record on this file; empty before observations exist. */
  regions: MapRegion[]
  unused: boolean
}
export type MapLot = { id: string; label: string; fileIds: string[]; singleSource: boolean }

/**
 * How the evidence became lots. A file supports a lot when it is linked to the lot, to the lot's
 * Part or to a lot it was split or merged from, or when one of its observed regions is in the lot.
 */
export function reviewMap(
  batch: CaptureSnapshotDto,
  evidence: MediaSnapshotDto['evidence'],
  retiredLotIds: ReadonlySet<string>,
  predecessors: ReadonlyMap<string, readonly string[]> = new Map(),
) {
  const lots = batch.lots.filter((lot) => !retiredLotIds.has(lot.id))
  const earlier = new Map(lots.map((lot) => [lot.id, ancestors(predecessors, lot.id)]))

  const via = (
    file: MediaSnapshotDto['evidence'][number],
    lot: (typeof lots)[number],
  ): MapLink['via'] | null => {
    if (file.linked_subject_ids.includes(lot.id)) {
      return 'direct'
    }
    if (lot.part_subject_id !== null && file.linked_subject_ids.includes(lot.part_subject_id)) {
      return 'part'
    }
    const lineage = earlier.get(lot.id)
    return file.linked_subject_ids.some((id) => lineage?.has(id)) ? 'earlier' : null
  }

  const active = new Set(lots.map((lot) => lot.id))
  const observations = (batch.evidence_observations ?? []).filter(
    (item) => item.status === 'active',
  )

  const regionsOf = (file: MediaSnapshotDto['evidence'][number]): MapRegion[] => {
    const versions = new Set((file.versions ?? []).map((version) => version.id))
    return observations
      .filter((item) => versions.has(item.evidence_version_id))
      .map((item, index) => ({
        id: item.id,
        label: item.readings?.markings?.[0] ?? item.readings?.text ?? `Region ${index + 1}`,
        lotId:
          item.lot_id !== null && item.lot_id !== undefined && active.has(item.lot_id)
            ? item.lot_id
            : null,
      }))
  }

  const names = evidenceDisplayNames(evidence)
  const files: MapFile[] = evidence.map((file) => {
    const links: MapLink[] = lots.flatMap((lot) => {
      const route = via(file, lot)
      return route ? [{ lotId: lot.id, via: route }] : []
    })
    const regions = regionsOf(file)
    const lotIds = [
      ...new Set([
        ...links.map((link) => link.lotId),
        ...regions.flatMap((region) => (region.lotId ? [region.lotId] : [])),
      ]),
    ]
    return {
      id: file.id,
      label: names.get(file.id) ?? file.label,
      lotIds,
      links,
      regions,
      unused: lotIds.length === 0,
    }
  })
  const mapLots: MapLot[] = lots.map((lot) => {
    const fileIds = files.filter((file) => file.lotIds.includes(lot.id)).map((file) => file.id)
    return { id: lot.id, label: lot.label, fileIds, singleSource: fileIds.length === 1 }
  })

  return { files, lots: mapLots }
}
