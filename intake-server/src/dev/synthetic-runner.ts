import type { ProcessingEnvelopeV2Dto, ProcessingSourceDto } from '@invimport/contracts'
import { sha256 } from '#/db/authority.ts'
import { decodeMediaInputs } from '#/media/inputs.ts'
import { evidenceNotes } from '#/capture/context-input.ts'
import type { RestrictedResearchRunner } from '#/processing/runner.ts'

/** Deterministic development runner: cites retained evidence only; no model or inventory research. */
export const syntheticDevelopmentRunner: RestrictedResearchRunner = {
  qualification: 'fixture_only',
  profileId: 'synthetic-research/2',
  async run(command, emit) {
    const input = command.manifest
    if (
      input.schema_version !== 'bench-intake-input/2' &&
      input.schema_version !== 'bench-intake-input/5'
    ) {
      throw new Error('synthetic_input_required')
    }
    const binding = {
      schema_version: 'bench-intake-runner/2',
      profile_id: 'synthetic-research/2',
      handler_version: 'processing/2',
      job_id: command.payload.job_id,
      attempt_id: command.payload.attempt_id,
      command_id: command.payload.command_id,
      input_sha256: command.payload.input_sha256,
    } as const
    const media = decodeMediaInputs(
      Buffer.from(input.media.manifest),
      Buffer.from(input.media.sha256, 'hex'),
    )
    const sources: ProcessingSourceDto[] = [
      ...evidenceNotes(input.notes, input.batch_id).map((note) => ({
        kind: 'note' as const,
        note_id: note.id,
        text_sha256: sha256(note.text).toString('hex'),
      })),
      ...media.versions.map((version) => ({
        kind: 'media_version' as const,
        version_id: version.versionId,
        evidence_id: version.evidenceId,
        sha256: version.digest,
      })),
    ]
    const proposal: ProcessingEnvelopeV2Dto = {
      ...binding,
      sequence: '1',
      kind: 'proposal',
      payload: {
        schema_version: 'bench-intake-proposal/2',
        subject_id: input.subject_id,
        summary:
          'SYNTHETIC development result from retained notes and media descriptors. No model inference, image inspection or inventory research was performed.',
        sources,
      },
    }
    await emit(proposal)
    await emit({ ...binding, sequence: '2', kind: 'terminal', payload: { state: 'ready' } })
  },
}
