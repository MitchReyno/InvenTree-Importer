import type { CaptureSnapshotDto, MediaEvidenceDto, MediaSnapshotDto } from '@invimport/contracts'
import { fail } from '#/capture/model.ts'

/** Completed versions consume one slot; only explicit non-publishing outcomes release a reservation. */
export function reservedVersionCount(evidence: MediaEvidenceDto, snapshot: MediaSnapshotDto) {
  const publishedVersions = new Set(evidence.versions.map((version) => version.id))
  const nonPublishingOutcomes = new Set([
    'unsupported',
    'encrypted',
    'malformed',
    'limit_exceeded',
    'interrupted',
  ])
  const pending = snapshot.derivations.filter((derivation) => {
    if (derivation.evidence_id !== evidence.id) {
      return false
    }
    if (derivation.version_id && publishedVersions.has(derivation.version_id)) {
      return false
    }
    return !nonPublishingOutcomes.has(derivation.state)
  })
  return evidence.versions.length + pending.length
}

/** Retired lots are frozen history: evidence links and attachments no longer change. */
export function requireActiveLot(capture: CaptureSnapshotDto, subjectId: string) {
  const lot = capture.lots.find((subject) => subject.id === subjectId)
  if (lot?.retired === true) {
    fail('lot_retired', 409)
  }
}
