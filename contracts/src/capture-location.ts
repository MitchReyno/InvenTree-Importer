import { Type, type Static } from '@sinclair/typebox'
import { CaptureRef, object } from './capture-primitives.ts'
import { Id, Revision } from './scalars.ts'
import type { CaptureSnapshotDto } from './capture.ts'

/** A shared-Part or evidence-group assignment. Absence means no assignment; `unknown` is not one. */
export const CaptureAssignedLocation = Type.Union([
  object({ mode: Type.Literal('clear') }),
  object({ mode: Type.Literal('set'), value: CaptureRef }),
])
/** Commands remove an assignment with `unset`. */
export const CaptureAssignedLocationChange = Type.Union([
  object({ mode: Type.Literal('unset') }),
  ...CaptureAssignedLocation.anyOf,
])
export const CaptureGroupLocation = object({
  group_id: Id,
  version: Revision,
  location: CaptureAssignedLocation,
})
export const CaptureGroupLocationChange = object({
  kind: Type.Literal('group_location'),
  group_id: Id,
  location: CaptureAssignedLocationChange,
})

export type CaptureAssignedLocationDto = Static<typeof CaptureAssignedLocation>
export type CaptureAssignedLocationChangeDto = Static<typeof CaptureAssignedLocationChange>
export type CaptureGroupLocationDto = Static<typeof CaptureGroupLocation>

type Lot = CaptureSnapshotDto['lots'][number]
type ResolvedLocation = Exclude<Lot['location'], { mode: 'inherit' }>

/** Group IDs holding evidence linked to each lot; `null` when media membership is unavailable. */
export type LotLocationGroups = ReadonlyMap<string, readonly string[]>

/** The groups holding each subject's linked evidence, from a media snapshot's evidence list. */
export function lotLocationGroups(
  evidence: readonly { group_id: string | null; linked_subject_ids: readonly string[] }[],
): LotLocationGroups {
  const groups = new Map<string, string[]>()
  for (const item of evidence) {
    if (item.group_id === null) {
      continue
    }
    for (const subjectId of item.linked_subject_ids) {
      const current = groups.get(subjectId) ?? []
      if (!current.includes(item.group_id)) {
        groups.set(subjectId, [...current, item.group_id].sort())
      }
    }
  }
  return groups
}

export type LotLocationResolution =
  | { status: 'resolved'; source: 'lot' | 'part' | 'batch'; location: ResolvedLocation }
  | { status: 'resolved'; source: 'group'; location: ResolvedLocation; group_ids: string[] }
  | { status: 'conflict'; group_ids: string[] }
  | { status: 'groups_unavailable' }

const sameLocation = (a: CaptureAssignedLocationDto, b: CaptureAssignedLocationDto) =>
  a.mode === b.mode &&
  (a.mode === 'clear' ||
    (b.mode === 'set' &&
      a.value.pk === b.value.pk &&
      a.value.target_context_id === b.value.target_context_id))

/**
 * Resolves one physical lot's location: lot, then its shared Part, then the groups holding its
 * linked evidence (which must agree), then the batch default. `clear` at any level stops the
 * fallback. Resolution never merges lots or changes quantities.
 */
export function resolveLotLocation(
  snapshot: CaptureSnapshotDto,
  lot: Lot,
  lotGroups: LotLocationGroups | null,
): LotLocationResolution {
  if (lot.location.mode !== 'inherit') {
    return { status: 'resolved', source: 'lot', location: lot.location }
  }
  const part = snapshot.parts.find((value) => value.id === lot.part_subject_id)
  if (part?.location) {
    return { status: 'resolved', source: 'part', location: part.location }
  }
  const assignments = snapshot.group_locations ?? []
  if (assignments.length) {
    if (!lotGroups) {
      return { status: 'groups_unavailable' }
    }
    const linked = new Set(lotGroups.get(lot.id) ?? [])
    const applicable = assignments.filter((value) => linked.has(value.group_id))
    if (applicable.length) {
      const group_ids = applicable.map((value) => value.group_id)
      const [first, ...rest] = applicable
      if (rest.some((value) => !sameLocation(first.location, value.location))) {
        return { status: 'conflict', group_ids }
      }
      return { status: 'resolved', source: 'group', location: first.location, group_ids }
    }
  }
  return {
    status: 'resolved',
    source: 'batch',
    location: snapshot.defaults.location as ResolvedLocation,
  }
}
