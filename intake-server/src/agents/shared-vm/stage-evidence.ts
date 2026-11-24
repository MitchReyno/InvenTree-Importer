import { createHash, randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const extensions = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
])

export type EvidenceDelivery = 'inline' | 'file'

export function evidenceDelivery(value: string | undefined): EvidenceDelivery {
  if (value === undefined || value === '' || value === 'file') {
    return 'file'
  }
  if (value === 'inline') {
    return 'inline'
  }
  throw new Error('invalid_evidence_delivery')
}

/** Expose the delivered image to guest scripts, keeping the original version as its citation. */
export async function stageEvidence(
  id: string | number,
  body: string,
  directory: () => Promise<string>,
  delivery: EvidenceDelivery = 'file',
  format?: unknown,
) {
  const reply = JSON.parse(body)
  const result = reply?.result
  const metadata = result?.structuredContent
  const images = result?.content?.filter((item: { type: string }) => item.type === 'image')
  if (!images?.length) {
    return body
  }
  if (images.length !== 1 || reply?.id !== id || result?.isError || metadata?.ok !== true) {
    throw new Error('invalid_evidence_file')
  }
  const [image] = images
  if (format !== 'legacy' && format !== 'current') {
    throw new Error('invalid_evidence_format')
  }
  if (format === 'current' && !metadata.delivered) {
    throw new Error('invalid_evidence_file')
  }
  const extension = extensions.get(image.mimeType)
  if (!extension || typeof image.data !== 'string' || metadata.source?.kind !== 'media_version') {
    throw new Error('invalid_evidence_file')
  }
  const bytes = Buffer.from(image.data, 'base64')
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const expected = expectedDigest(metadata, image.mimeType)
  if (expected !== undefined && sha256 !== expected) {
    throw new Error('invalid_evidence_file')
  }
  const path = join(await directory(), randomUUID() + '.' + extension)
  await writeFile(path, bytes, { flag: 'wx', mode: 0o600 })
  metadata.local_file = { path, sha256, byte_length: bytes.length, media_type: image.mimeType }
  const guidance = {
    type: 'text',
    text: 'Open local_file.path with your image/file tool to inspect this image. The file exists only for this turn; fetch evidence again on later turns. Cite the source metadata, not the temporary path.',
  }
  result.content = [
    { type: 'text', text: JSON.stringify(metadata) },
    delivery === 'file' ? guidance : image,
  ]
  return JSON.stringify(reply)
}

const PREVIEW_GUIDANCE =
  'These are previews of your figures with their marks drawn in, as files in local_files, in figure order. Open each path with your image/file tool to check what the operator will see. The files exist only for this turn. A preview grants no citation; cite only fetched evidence.'

/**
 * Exposes an `ask` preview's images to guest scripts in the configured delivery mode. Each image
 * must match the preview entry the trusted host listed for it. Nothing is released: a preview
 * grants no citation.
 */
export async function stagePreview(
  id: string | number,
  body: string,
  directory: () => Promise<string>,
  delivery: EvidenceDelivery = 'file',
) {
  const reply = JSON.parse(body)
  const result = reply?.result
  const metadata = result?.structuredContent
  const images = result?.content?.filter((item: { type: string }) => item.type === 'image')
  if (!images?.length) {
    return body
  }
  const listed = metadata?.preview
  if (
    reply?.id !== id ||
    result?.isError ||
    metadata?.ok !== true ||
    metadata.source !== undefined ||
    !Array.isArray(listed) ||
    listed.length !== images.length ||
    images.length > 5
  ) {
    throw new Error('invalid_preview_file')
  }
  const files = []
  for (const [index, image] of images.entries()) {
    const extension = extensions.get(image.mimeType)
    const entry = listed[index]
    if (!extension || typeof image.data !== 'string' || entry?.media_type !== image.mimeType) {
      throw new Error('invalid_preview_file')
    }
    const bytes = Buffer.from(image.data, 'base64')
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    if (sha256 !== entry.sha256) {
      throw new Error('invalid_preview_file')
    }
    const path = join(await directory(), randomUUID() + '.' + extension)
    await writeFile(path, bytes, { flag: 'wx', mode: 0o600 })
    files.push({
      figure: entry.figure,
      path,
      sha256,
      byte_length: bytes.length,
      media_type: image.mimeType,
    })
  }
  metadata.local_files = files
  result.content = [
    { type: 'text', text: JSON.stringify(metadata) },
    ...(delivery === 'file' ? [{ type: 'text', text: PREVIEW_GUIDANCE }] : images),
  ]
  return JSON.stringify(reply)
}

/**
 * The digest the delivered bytes must have. A bounded delivery states its own; a host from before
 * bounded deliveries sent the original (its source digest) or, with page sizes, a preview cut,
 * which has none to check, so a guest updated first keeps working with it.
 */
function expectedDigest(
  metadata: { source: { sha256?: unknown }; pages?: unknown; delivered?: Record<string, unknown> },
  mediaType: string,
) {
  const delivered = metadata.delivered
  if (delivered !== undefined) {
    if (typeof delivered.sha256 !== 'string' || delivered.media_type !== mediaType) {
      throw new Error('invalid_evidence_file')
    }
    return delivered.sha256
  }
  if (Array.isArray(metadata.pages)) {
    return undefined
  }
  // An older host's original must still name the digest it is checked against.
  if (typeof metadata.source.sha256 !== 'string') {
    throw new Error('invalid_evidence_file')
  }
  return metadata.source.sha256
}
