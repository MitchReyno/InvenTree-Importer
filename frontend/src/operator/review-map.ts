import { lotItemCount, type CaptureSnapshotDto, type MediaSnapshotDto } from '@invimport/contracts'
import { evidenceDisplayNames } from '#/media/identity-labels'

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
export type MapRegion = {
  id: string
  label: string
  lotId: string | null
  /** A photo region shows the item; a document line only supports it. */
  kind: 'pixels' | 'lines'
  /** The region of the same lot that shows the same physical item. */
  sameItemAs?: string
}

/** A drawn connector: solid where the file shows the lot, dotted where it only supports it. */
export type MapEdge = { lotId: string; style: 'solid' | 'dotted' }

export type MapFile = {
  id: string
  label: string
  /** Lots the file supports, through a file link or one of its regions. */
  lotIds: string[]
  /** File-level links, which the Map can unlink. */
  links: MapLink[]
  /** Regions observations record on this file; empty before observations exist. */
  regions: MapRegion[]
  edges: MapEdge[]
  unused: boolean
}
export type MapLot = {
  id: string
  label: string
  fileIds: string[]
  /** Active observations in the lot; zero before observations exist. */
  observations: number
  /** One observation once observations exist, otherwise one file. */
  singleSource: boolean
  /** Items the observations count, each physical item once; null when none counts. */
  counted: number | null
  /** Observations marked as showing an item another one already shows. */
  seenAgain: number
}

/**
 * How the evidence became lots. A file supports a lot when it is linked to the lot, to the lot's
 * Part or to a lot it was split or merged from, or when one of its observed regions is in the lot.
 */
export function reviewMap(
  batch: CaptureSnapshotDto,
  evidence: MediaSnapshotDto['evidence'],
  retiredLotIds: ReadonlySet<string>,
  predecessors: ReadonlyMap<string, readonly string[]> = new Map(),
  /** Deleted files, which share the numbering of names with the present ones. */
  removed: MediaSnapshotDto['removed'] = [],
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
        label:
          item.readings?.markings?.find(Boolean) || item.readings?.text || `Region ${index + 1}`,
        lotId:
          item.lot_id !== null && item.lot_id !== undefined && active.has(item.lot_id)
            ? item.lot_id
            : null,
        kind: item.region.kind,
        ...(item.same_item_as ? { sameItemAs: item.same_item_as } : {}),
      }))
  }

  const names = evidenceDisplayNames(evidence, removed)
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

    const shows = (lotId: string) =>
      links.some((link) => link.lotId === lotId && link.via === 'direct') ||
      regions.some((region) => region.lotId === lotId && region.kind === 'pixels')

    return {
      id: file.id,
      label: names.get(file.id) ?? file.label,
      lotIds,
      links,
      regions,
      edges: lotIds.map((lotId) => ({ lotId, style: shows(lotId) ? 'solid' : 'dotted' })),
      unused: lotIds.length === 0,
    }
  })
  const mapLots: MapLot[] = lots.map((lot) => {
    const fileIds = files.filter((file) => file.lotIds.includes(lot.id)).map((file) => file.id)
    const count = observations.filter((item) => item.lot_id === lot.id).length
    return {
      id: lot.id,
      label: lot.label,
      fileIds,
      observations: count,
      singleSource: count > 0 ? count === 1 : fileIds.length === 1,
      counted: lotItemCount(observations, lot.id),
      seenAgain: observations.filter((item) => item.lot_id === lot.id && item.same_item_as).length,
    }
  })

  return { files, lots: mapLots }
}

/** The Map's unused files, counted the way the Map marks them, for the batch header's badge. */
export function unusedEvidenceCount(
  batch: CaptureSnapshotDto,
  evidence: MediaSnapshotDto['evidence'],
  retiredLotIds: ReadonlySet<string>,
  predecessors: ReadonlyMap<string, readonly string[]>,
) {
  return reviewMap(batch, evidence, retiredLotIds, predecessors).files.filter((file) => file.unused)
    .length
}
