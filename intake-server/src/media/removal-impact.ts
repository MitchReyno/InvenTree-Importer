import type { CaptureSnapshotDto, MediaEvidenceDto, MediaSnapshotDto } from '@invimport/contracts'

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

/** What removing each present item would change, for the delete dialog and its refusal state. */
export function removalImpacts(input: RemovalImpactInput): Map<string, RemovalImpact> {
  const lots = input.capture.lots.filter((lot) => lot.retired !== true)
  const lotIds = new Set(lots.map((lot) => lot.id))
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
  const impacts = new Map<string, RemovalImpact>()
  for (const item of input.evidence) {
    const versionIds = new Set(item.versions.map((version) => version.id))
    const cleared = input.attachments.filter(
      (selection) =>
        selection.mode === 'selected' &&
        selection.version_id !== null &&
        versionIds.has(selection.version_id),
    )
    // The delete appends an `unset` selection in place of each cleared one.
    const attachmentsAfter = input.attachments.map((selection) =>
      cleared.includes(selection)
        ? { ...selection, mode: 'unset' as const, version_id: null }
        : selection,
    )
    const others = input.evidence.filter((other) => other.id !== item.id)
    const sole = lots
      .filter((lot) => {
        const subjects = evidenceSubjects.get(lot.id)!
        const before = supported(subjects, noted.get(lot.id)!, input.evidence, input.attachments)
        const after = supported(subjects, noted.get(lot.id)!, others, attachmentsAfter)
        return before && !after
      })
      .map((lot) => lot.id)
    const fed = item.linked_subject_ids.filter((subjectId) => lotIds.has(subjectId))
    const impact: RemovalImpact = {}
    if (fed.length) {
      impact.lot_ids = [...fed].sort()
    }
    if (sole.length) {
      impact.sole_evidence_lot_ids = sole.sort()
    }
    if (cleared.length) {
      impact.selected_attachment_of = cleared.map((selection) => ({
        subject_id: selection.subject_id,
        destination: selection.destination,
      }))
    }
    impacts.set(item.id, impact)
  }
  return impacts
}
