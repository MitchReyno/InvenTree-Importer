import { createHash, randomUUID } from 'node:crypto'
import type { ProcessingCommandV3Dto } from '@invimport/contracts'
import { canonicalMedia } from '../../src/media/encoding.ts'
import { researchInputManifest, sealed } from '../../src/processing/model.ts'
import { processingProfiles } from '../../src/processing/policy.ts'
import type { ResearchInput } from '../../src/processing/runner.ts'
import { manualInputFixture } from './processing-input.ts'

export function literalResearchPdf() {
  const content = '1 0 0 rg 0 0 40 60 re f 0 0 1 rg 40 0 40 60 re f\n'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 80 60] /Resources << >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`,
  ]
  let bytes = '%PDF-1.4\n'
  const offsets: number[] = []
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(bytes))
    bytes += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = Buffer.byteLength(bytes)
  bytes += 'xref\n0 5\n0000000000 65535 f \n'
  for (const offset of offsets) {
    bytes += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  bytes += `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(bytes)
}

/** Literal artifact transport fixture, never model/content-understanding evidence. */
export function researchInputFixture(
  adjust: (capture: ReturnType<typeof manualInputFixture>) => void = () => {},
) {
  const capture = manualInputFixture()
  adjust(capture)
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jLZkAAAAASUVORK5CYII=',
    'base64',
  )
  const pdf = literalResearchPdf()
  const artifacts = [
    { bytes: png, mediaType: 'image/png' },
    { bytes: pdf, mediaType: 'application/pdf' },
  ].map((artifact) => ({
    ...artifact,
    versionId: randomUUID(),
    evidenceId: randomUUID(),
    digest: createHash('sha256').update(artifact.bytes).digest('hex'),
  }))
  const mediaBytes = Buffer.from(
    canonicalMedia({
      version: 'media-inputs/1',
      batchId: capture.id,
      subjectIds: [capture.lots[0].id],
      attachments: [],
      evidence: artifacts.map((artifact) => ({
        evidenceId: artifact.evidenceId,
        groupId: null,
        linkedSubjectIds: [capture.lots[0].id],
      })),
      versions: artifacts.map((artifact) => ({
        versionId: artifact.versionId,
        evidenceId: artifact.evidenceId,
        kind: 'original',
        digest: artifact.digest,
        byteSize: String(artifact.bytes.length),
        mediaType: artifact.mediaType,
        recipe: null,
      })),
    }),
  )
  const manifest = researchInputManifest(
    capture,
    capture.lots[0].id,
    'research',
    [],
    null,
    {
      manifest: mediaBytes.toString(),
      sha256: createHash('sha256').update(mediaBytes).digest('hex'),
    },
    ['https://manufacturer.example/data.pdf'],
  )
  const payload: ProcessingCommandV3Dto = {
    schema_version: 'bench-intake-processing-command/3',
    job_id: randomUUID(),
    attempt_id: randomUUID(),
    input_id: randomUUID(),
    input_sha256: sealed(manifest).digest.toString('hex'),
    profile_id: 'restricted-research-stub/1',
    handler_version: 'processing/3',
    command_id: randomUUID(),
  }
  const input: ResearchInput = {
    manifest,
    payload,
    instructions: processingProfiles[manifest.profile_id].instructions,
  }
  return { input, manifest, artifacts, capture }
}
