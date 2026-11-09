import {
  validate,
  type ProcessingInputV3Dto,
  type ResearchEvidenceChunkDto,
  type ResearchEvidenceReadDto,
} from '@invimport/contracts'
import { decodeMediaInputs } from '#/media/inputs.ts'
import { sha256 } from '#/db/authority.ts'
import { MAX_UPLOAD_BYTES } from '#/media/blob-store.ts'
import { assertResearchActive, refuseResearch } from './errors.ts'
import { MAX_RESEARCH_CHUNK_BYTES } from './limits.ts'
import { awaitResearchResult } from './abort.ts'

export type EvidenceByteReader = (versionId: string) => Promise<Buffer>

export function researchChunk(bytes: Buffer, offset: string, length: string): Buffer {
  const start = BigInt(offset)
  const count = BigInt(length)
  if (start >= BigInt(bytes.length) || count <= 0n || count > BigInt(MAX_RESEARCH_CHUNK_BYTES)) {
    refuseResearch('research_capacity')
  }
  const end = start + count
  return bytes.subarray(
    Number(start),
    Number(end > BigInt(bytes.length) ? BigInt(bytes.length) : end),
  )
}

/** The reader closure owns object authorization; exact manifest membership narrows it per attempt. */
export function stagedEvidenceReader(input: ProcessingInputV3Dto, readVersion: EvidenceByteReader) {
  validate('ProcessingInputV3', input)
  const manifest = structuredClone(input)
  const media = decodeMediaInputs(
    Buffer.from(manifest.media.manifest),
    Buffer.from(manifest.media.sha256, 'hex'),
  )
  return async function readEvidence(
    request: ResearchEvidenceReadDto,
    signal: AbortSignal,
  ): Promise<ResearchEvidenceChunkDto> {
    validate('ResearchEvidenceRead', request)
    assertResearchActive(signal)
    const version = media.versions.find(
      (candidate) =>
        candidate.versionId === request.version_id && candidate.digest === request.sha256,
    )
    if (!version || !['image/png', 'image/jpeg', 'application/pdf'].includes(version.mediaType)) {
      refuseResearch('research_evidence_invalid')
    }
    if (
      BigInt(request.length) > BigInt(MAX_RESEARCH_CHUNK_BYTES) ||
      BigInt(request.offset) >= BigInt(version.byteSize)
    ) {
      refuseResearch('research_capacity')
    }
    const bytes = await awaitResearchResult(readVersion(version.versionId), signal)
    assertResearchActive(signal)
    if (
      bytes.length === 0 ||
      bytes.length > MAX_UPLOAD_BYTES ||
      String(bytes.length) !== version.byteSize ||
      sha256(bytes).toString('hex') !== version.digest
    ) {
      refuseResearch('research_evidence_invalid')
    }
    const chunk = researchChunk(bytes, request.offset, request.length)
    const result: ResearchEvidenceChunkDto = {
      evidence_id: version.evidenceId,
      version_id: version.versionId,
      sha256: version.digest,
      byte_size: version.byteSize,
      media_type: version.mediaType,
      offset: request.offset,
      bytes_base64: chunk.toString('base64'),
    }
    validate('ResearchEvidenceChunk', result)
    return result
  }
}
