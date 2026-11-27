import type { CaptureSnapshotDto, MediaEvidenceDto, MediaSnapshotDto } from '@invimport/contracts'
import { selectionsOfVersions } from './removal.ts'

type Attachment = MediaSnapshotDto['attachments'][number]

export interface RemovalImpactInput {
  capture: Pick<CaptureSnapshotDto, 'lots' | 'notes'>
  /** Successor lot → its direct predecessors, from the capture review context. */
  predecessors: ReadonlyMap<string, readonly string[]>
  /** Present evidence only. */
  evidence: readonly MediaEvidenceDto[]
  attachments: readonly Attachment[]
}

export interface RemovalImpact {
  lot_ids?: string[]
  sole_evidence_lot_ids?: string[]
  selected_attachment_of?: { subject_id: string; destination: Attachment['destination'] }[]
}

/** Lineage is shallow in practice; the bound only guards a pathological chain. */
const MAX_LINEAGE_DEPTH = 32

function ancestors(predecessors: RemovalImpactInput['predecessors'], lotId: string) {
  const found = new Set<string>()
  let frontier = [...(predecessors.get(lotId) ?? [])]
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
  return found
}

/**
 * Mirrors Review's `no_supporting_evidence` rule (`review/model.ts`): a lot is supported by a
 * written note on it, an ancestor or its Part, by present evidence linked to one of those, or by
 * a current attachment selection Processing inputs carry for one of them.
 */
function supported(
  subjects: ReadonlySet<string>,
  noted: boolean,
  evidence: readonly MediaEvidenceDto[],
  attachments: readonly Attachment[],
) {
  if (noted) {
    return true
  }
  const linked = evidence.some((item) =>
    item.linked_subject_ids.some((subjectId) => subjects.has(subjectId)),
  )
  const selected = attachments.some(
    (selection) =>
      subjects.has(selection.subject_id) &&
      (selection.destination === 'lot_attachment' || selection.mode === 'selected'),
  )
  return linked || selected
}

interface LotSupport {
  lots: CaptureSnapshotDto['lots']
  lotIds: ReadonlySet<string>
  /** Each active lot's evidence subjects: itself, its ancestors and its Part. */
  evidenceSubjects: ReadonlyMap<string, ReadonlySet<string>>
  noted: ReadonlyMap<string, boolean>
}

function lotSupport(input: RemovalImpactInput): LotSupport {
  const lots = input.capture.lots.filter((lot) => lot.retired !== true)
  const evidenceSubjects = new Map(
    lots.map((lot) => {
      const subjects = new Set([lot.id, ...ancestors(input.predecessors, lot.id)])
      if (lot.part_subject_id) {
        subjects.add(lot.part_subject_id)
      }
      return [lot.id, subjects]
    }),
  )
  const noted = new Map(
    lots.map((lot) => {
      const subjects = evidenceSubjects.get(lot.id)!
      const hasNote = input.capture.notes.some(
        (note) =>
          note.subject_id !== null && subjects.has(note.subject_id) && note.text.trim() !== '',
      )
      return [lot.id, hasNote]
    }),
  )
  return { lots, lotIds: new Set(lots.map((lot) => lot.id)), evidenceSubjects, noted }
}

/** What removing these present items together would change. */
function impactOf(
  input: RemovalImpactInput,
  support: LotSupport,
  evidenceIds: ReadonlySet<string>,
): Required<RemovalImpact> {
  const removed = input.evidence.filter((item) => evidenceIds.has(item.id))
  const versionIds = new Set(removed.flatMap((item) => item.versions.map((version) => version.id)))
  const cleared = selectionsOfVersions(input.attachments, versionIds)
  // The delete appends an `unset` selection in place of each cleared one.
  const attachmentsAfter = input.attachments.map((selection) =>
    cleared.includes(selection)
      ? { ...selection, mode: 'unset' as const, version_id: null }
      : selection,
  )
  const remaining = input.evidence.filter((item) => !evidenceIds.has(item.id))
  const sole = support.lots
    .filter((lot) => {
      const subjects = support.evidenceSubjects.get(lot.id)!
      const noted = support.noted.get(lot.id)!
      const before = supported(subjects, noted, input.evidence, input.attachments)
      const after = supported(subjects, noted, remaining, attachmentsAfter)
      return before && !after
    })
    .map((lot) => lot.id)
  const fed = new Set(
    removed.flatMap((item) =>
      item.linked_subject_ids.filter((subjectId) => support.lotIds.has(subjectId)),
    ),
  )
  return {
    lot_ids: [...fed].sort(),
    sole_evidence_lot_ids: sole.sort(),
    selected_attachment_of: cleared.map((selection) => ({
      subject_id: selection.subject_id,
      destination: selection.destination,
    })),
  }
}

/** What removing each present item alone would change, for the delete dialog and its refusals. */
export function removalImpacts(input: RemovalImpactInput): Map<string, RemovalImpact> {
  const support = lotSupport(input)
  const impacts = new Map<string, RemovalImpact>()
  for (const item of input.evidence) {
    const impact = impactOf(input, support, new Set([item.id]))
    // Each field is omitted while empty, so existing snapshots keep their bytes.
    impacts.set(item.id, {
      ...(impact.lot_ids.length ? { lot_ids: impact.lot_ids } : {}),
      ...(impact.sole_evidence_lot_ids.length
        ? { sole_evidence_lot_ids: impact.sole_evidence_lot_ids }
        : {}),
      ...(impact.selected_attachment_of.length
        ? { selected_attachment_of: impact.selected_attachment_of }
        : {}),
    })
  }
  return impacts
}

/** What removing these present items together would change, for a bulk delete. */
export function combinedRemovalImpact(input: RemovalImpactInput, evidenceIds: ReadonlySet<string>) {
  return impactOf(input, lotSupport(input), evidenceIds)
}
