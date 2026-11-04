import type { ProcessingInputDto, ProcessingProposalDto } from '@invimport/contracts'
import { sha256 } from '../db/authority.ts'
import { evidenceNotes } from '../capture/context-input.ts'
import { decodeMediaInputs } from '../media/inputs.ts'
import { fail } from './model.ts'

/** Retained command-media pin verification is additionally required at the caller's authority boundary. */
export function validateProposalSources(
  manifest: ProcessingInputDto,
  proposal: ProcessingProposalDto,
): void {
  if (proposal.subject_id !== manifest.subject_id) {
    fail('runner_subject_mismatch', 422)
  }

  // Requested automation is intent, not evidence, so no proposal may cite it as a source.
  const notesById = new Map(
    evidenceNotes(manifest.notes, manifest.batch_id).map((note) => [note.id, note]),
  )
  if (manifest.schema_version === 'bench-intake-input/1') {
    if (!('source_note_ids' in proposal)) {
      fail('runner_source_version_mismatch', 422)
    }

    if (proposal.source_note_ids.some((noteId) => !notesById.has(noteId))) {
      fail('runner_source_mismatch', 422)
    }

    return
  }

  if (!('sources' in proposal)) {
    fail('runner_source_version_mismatch', 422)
  }
  const restrictedInput = manifest.schema_version === 'bench-intake-input/3'
  const restrictedProposal = proposal.schema_version === 'bench-intake-proposal/3'
  if (restrictedInput !== restrictedProposal) {
    fail('runner_source_version_mismatch', 422)
  }

  const media = decodeMediaInputs(
    Buffer.from(manifest.media.manifest, 'utf8'),
    Buffer.from(manifest.media.sha256, 'hex'),
  )
  const versionsById = new Map(media.versions.map((version) => [version.versionId, version]))
  for (const source of proposal.sources) {
    if (source.kind === 'research_receipt') {
      if (!restrictedInput) {
        fail('runner_source_version_mismatch', 422)
      }
      // The caller additionally verifies exact retained receipt authority on its transaction.
      continue
    }
    if (source.kind === 'note') {
      const note = notesById.get(source.note_id)
      if (!note || sha256(Buffer.from(note.text, 'utf8')).toString('hex') !== source.text_sha256) {
        fail('runner_source_mismatch', 422)
      }

      continue
    }

    const version = versionsById.get(source.version_id)
    const exactVersionMatches =
      version?.evidenceId === source.evidence_id && version.digest === source.sha256
    if (!exactVersionMatches) {
      fail('runner_source_mismatch', 422)
    }
  }
}
