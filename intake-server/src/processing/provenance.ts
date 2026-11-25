import type {
  ProcessingInputDto,
  ProcessingProposalDto,
  RetainedSessionProposalDto,
  ResearchV1Dto,
  SessionProposalDto,
  ProcessingSourceDto,
  ProcessingSourceV3Dto,
  StageProposalDto,
  WebPageSourceDto,
} from '@invimport/contracts'
import { sha256 } from '#/db/authority.ts'
import { evidenceNotes } from '#/capture/context-input.ts'
import { decodeMediaInputs, type MediaInputVersion } from '#/media/inputs.ts'
import { fail } from './model.ts'

interface DeliveredEvidence {
  batchId: string
  notes: ProcessingInputDto['notes']
  media: { manifest: string; sha256: string }
}

/**
 * Checks note and media citations against exactly what one input delivered. Notes must match
 * their text digest and media must match the pinned version; automation intent is never evidence.
 */
export function deliveredSourceCheck(
  delivered: DeliveredEvidence,
  extraVersions: readonly Pick<MediaInputVersion, 'versionId' | 'evidenceId' | 'digest'>[] = [],
) {
  const notesById = new Map(
    evidenceNotes(delivered.notes, delivered.batchId).map((note) => [note.id, note]),
  )
  const media = decodeMediaInputs(
    Buffer.from(delivered.media.manifest, 'utf8'),
    Buffer.from(delivered.media.sha256, 'hex'),
  )
  const versionsById = new Map(
    [...media.versions, ...extraVersions].map((version) => [version.versionId, version]),
  )
  return (source: ProcessingSourceDto): boolean => {
    if (source.kind === 'note') {
      const note = notesById.get(source.note_id)
      return Boolean(
        note && sha256(Buffer.from(note.text, 'utf8')).toString('hex') === source.text_sha256,
      )
    }
    const version = versionsById.get(source.version_id)
    return version?.evidenceId === source.evidence_id && version.digest === source.sha256
  }
}

/** Retained command-media pin verification is additionally required at the caller's authority boundary. */
export function validateProposalSources(
  manifest: ProcessingInputDto,
  proposal: ProcessingProposalDto,
): void {
  if (proposal.subject_id !== manifest.subject_id) {
    fail('runner_subject_mismatch', 422)
  }

  if (manifest.schema_version === 'bench-intake-input/1') {
    if (!('source_note_ids' in proposal)) {
      fail('runner_source_version_mismatch', 422)
    }
    const noteIds = new Set(evidenceNotes(manifest.notes, manifest.batch_id).map((note) => note.id))
    if (proposal.source_note_ids.some((noteId) => !noteIds.has(noteId))) {
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

  const delivered = deliveredSourceCheck({
    batchId: manifest.batch_id,
    notes: manifest.notes,
    media: manifest.media,
  })
  for (const source of proposal.sources as ProcessingSourceV3Dto[]) {
    if (source.kind === 'research_receipt') {
      if (!restrictedInput) {
        fail('runner_source_version_mismatch', 422)
      }
      // The caller additionally verifies exact retained receipt authority on its transaction.
      continue
    }
    if (!delivered(source)) {
      fail('runner_source_mismatch', 422)
    }
  }
}

/** Every source a session catalogue value cites, including choices, companies and alternatives. */
export function catalogueSources(proposal: Pick<SessionProposalDto, 'catalogue'>) {
  const catalogue = proposal.catalogue
  if (!catalogue) {
    return []
  }
  return [
    ...(catalogue.category?.sources ?? []),
    ...catalogue.parameters.flatMap((parameter) => [
      ...parameter.sources,
      ...(parameter.alternatives ?? []).flatMap((other) => other.sources),
    ]),
    ...(catalogue.manufacturer
      ? [...catalogue.manufacturer.sources, ...catalogue.manufacturer.company.sources]
      : []),
    ...(catalogue.supplier
      ? [...catalogue.supplier.sources, ...catalogue.supplier.company.sources]
      : []),
    ...(catalogue.description?.sources ?? []),
  ]
}

type Citation = ProcessingSourceDto | WebPageSourceDto

/** Every source a session proposal cites: its top-level sources and those of each value. */
export function proposalCitations(proposal: RetainedSessionProposalDto): Citation[] {
  if (
    proposal.schema_version === 'bench-intake-proposal/5' ||
    proposal.schema_version === 'bench-intake-proposal/6'
  ) {
    return [...proposal.sources, ...catalogueSources(proposal)]
  }
  return stageOutputSources(proposal)
}

/** Every source a typed stage output cites, at the top level and in each of its values. */
function stageOutputSources(proposal: StageProposalDto): Citation[] {
  const fromNotes = (
    proposal.schema_version === 'images/1' ? [] : (proposal.match_notes ?? [])
  ).flatMap((note) => note.sources ?? [])
  switch (proposal.schema_version) {
    case 'examine-identity/1':
      return [...proposal.sources, ...fromNotes]
    case 'research-identity/1':
      return [
        ...proposal.sources,
        ...(proposal.aliases ?? []).flatMap((alias) => alias.sources),
        ...(proposal.cross_references ?? []).flatMap((reference) => reference.sources),
        ...fromNotes,
      ]
    case 'research/1':
      return [...proposal.sources, ...researchValueSources(proposal), ...fromNotes]
    case 'images/1':
      return [...proposal.sources]
  }
}

function researchValueSources(proposal: ResearchV1Dto) {
  const datasheet = proposal.datasheet
  return [
    ...(proposal.category?.sources ?? []),
    ...(proposal.name?.sources ?? []),
    ...(proposal.type?.sources ?? []),
    ...(proposal.manufacturer
      ? [...proposal.manufacturer.sources, ...proposal.manufacturer.company.sources]
      : []),
    ...(proposal.description?.sources ?? []),
    ...(proposal.parameters ?? []).flatMap((parameter) => [
      ...parameter.sources,
      ...(parameter.alternatives ?? []).flatMap((other) => other.sources),
    ]),
    ...(datasheet ? [...datasheet.sources, ...(datasheet.version ? [datasheet.version] : [])] : []),
    ...(proposal.conflicts ?? []).flatMap((conflict) => conflict.sources),
  ]
}
