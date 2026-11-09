import type { Pool } from 'pg'
import type {
  ProcessingInputV4Dto,
  ProcessingProposalV2Dto,
  ProcessingSourceDto,
} from '@invimport/contracts'
import { canonical } from '@invimport/contracts/json'
import { transaction } from '#/db/database.ts'
import { sha256 } from '#/db/authority.ts'
import type { BlobStore } from '#/media/blob-store.ts'
import { mediaContent } from '#/media/content.ts'
import { decodeMediaInputs } from '#/media/inputs.ts'
import { evidenceNotes } from '#/capture/context-input.ts'
import { CaptureError } from '#/capture/model.ts'
import type { ProcessingConfig } from '#/processing/attempts.ts'
import type { ResearchInput } from '#/processing/runner.ts'
import { loadProcessingAuthority } from '#/processing/authority.ts'
import type { NativePrompt } from './types.ts'

const MAX_NATIVE_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_NATIVE_IMAGES = 8
export interface StagedNativePrompt extends NativePrompt {
  sources: ProcessingSourceDto[]
}

/** Read only exact command-pinned versions through the owning media boundary, never provider-selected paths. */
export async function stageNativePrompt(
  pool: Pool,
  config: ProcessingConfig,
  store: BlobStore | undefined,
  input: ResearchInput,
  manifest: ProcessingInputV4Dto,
): Promise<StagedNativePrompt> {
  await transaction(pool, async (client) => {
    const retained = await loadProcessingAuthority(client, config, input.payload.attempt_id)
    if (
      canonical(retained.payload) !== canonical(input.payload) ||
      canonical(retained.manifest) !== canonical(manifest) ||
      retained.row.state !== 'running'
    ) {
      throw new Error('agent_input_invalid')
    }
  })
  const sources: ProcessingSourceDto[] = evidenceNotes(manifest.notes, manifest.batch_id).map(
    (note) => ({
      kind: 'note',
      note_id: note.id,
      text_sha256: sha256(Buffer.from(note.text)).toString('hex'),
    }),
  )
  const images: NativePrompt['images'] = []
  const unavailable: string[] = []
  const media = decodeMediaInputs(
    Buffer.from(manifest.media.manifest),
    Buffer.from(manifest.media.sha256, 'hex'),
  )
  let imageBytes = 0
  for (const version of media.versions) {
    const type = version.mediaType
    const supportedImage = type === 'image/jpeg' || type === 'image/png' || type === 'image/webp'
    const exceedsBudget =
      BigInt(version.byteSize) > BigInt(MAX_NATIVE_IMAGE_BYTES - imageBytes) ||
      images.length >= MAX_NATIVE_IMAGES
    if (!store || !supportedImage || exceedsBudget) {
      unavailable.push(version.versionId)
      continue
    }
    let bytes: Buffer
    try {
      bytes = await mediaContent(pool, config, store).original(manifest.batch_id, version.versionId)
    } catch (error) {
      // Evidence removed after the input was sealed never reaches the agent.
      if (error instanceof CaptureError && error.code === 'media_evidence_removed') {
        unavailable.push(version.versionId)
        continue
      }
      throw error
    }
    if (
      bytes.length.toString() !== version.byteSize ||
      sha256(bytes).toString('hex') !== version.digest
    ) {
      throw new Error('agent_media_invalid')
    }
    imageBytes += bytes.length
    images.push({ mediaType: type, base64: bytes.toString('base64') })
    sources.push({
      kind: 'media_version',
      evidence_id: version.evidenceId,
      version_id: version.versionId,
      sha256: version.digest,
    })
  }
  const context = {
    stage: manifest.stage,
    subject_id: manifest.subject_id,
    subject: manifest.subject,
    linked_part: manifest.linked_part,
    defaults: manifest.defaults,
    notes: manifest.notes,
    ...(media.context ? { media_context: media.context } : {}),
    inspected_sources: sources,
    unavailable_media_version_ids: unavailable,
    image_order: sources.filter((source) => source.kind === 'media_version'),
    output:
      'Return exactly one non-null proposal or question. The other field must be null. Never cite unavailable media or claim external research. Suggestions need human review.',
  }
  return { instructions: input.instructions, text: canonical(context), images, sources }
}

export function verifyInspectedSources(
  prompt: StagedNativePrompt,
  proposal: ProcessingProposalV2Dto,
) {
  const inspected = new Set(prompt.sources.map((source) => canonical(source)))
  if (proposal.sources.some((source) => !inspected.has(canonical(source)))) {
    throw new Error('agent_uninspected_source')
  }
}
