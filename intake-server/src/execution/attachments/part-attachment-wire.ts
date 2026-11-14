import { createHash } from 'node:crypto'
import type { MediaPlanEvidence } from '#/execution/media-plan.ts'
import { id, pk } from '#/execution/plan.ts'
import { responseObject, responsePk } from '#/execution/response.ts'

export interface PartAttachmentWire {
  artifactKey: string
  partPk: string
  version: MediaPlanEvidence
}
export interface PartAttachmentMetadata {
  pk: string
  partPk: string
  path: string
  filename: string
  comment: string
  byteSize: string
}

export function partAttachmentFilename(wire: PartAttachmentWire) {
  const extension =
    wire.version.mediaType === 'application/pdf'
      ? 'pdf'
      : wire.version.mediaType === 'image/jpeg'
        ? 'jpg'
        : 'png'
  return `bench-${wire.artifactKey}.${extension}`
}

export function partAttachmentComment(wire: PartAttachmentWire) {
  return `Bench Intake artifact ${wire.artifactKey}`
}

/** A deterministic recipe binds multipart framing and retained file bytes to one request intent. */
export function partAttachmentMultipart(wire: PartAttachmentWire, bytes: Buffer) {
  if (
    String(bytes.length) !== wire.version.byteSize ||
    createHash('sha256').update(bytes).digest('hex') !== wire.version.blobDigest
  ) {
    throw new Error('approved_part_attachment_bytes_changed')
  }
  id(wire.artifactKey)
  pk(wire.partPk)
  let boundary = ''
  for (let counter = 0; counter < 16; counter += 1) {
    const candidate = `bench-${createHash('sha256').update(`${wire.artifactKey}:${wire.version.blobDigest}:${counter}`).digest('hex').slice(0, 48)}`
    if (!bytes.includes(Buffer.from(candidate))) {
      boundary = candidate
      break
    }
  }
  if (!boundary) {
    throw new Error('multipart_boundary_unavailable')
  }
  const fields = { model_type: 'part', model_id: wire.partPk, comment: partAttachmentComment(wire) }
  const chunks: Buffer[] = []
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    )
  }
  chunks.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="attachment"; filename="${partAttachmentFilename(wire)}"\r\nContent-Type: ${wire.version.mediaType}\r\n\r\n`,
    ),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  )
  const body = Buffer.concat(chunks)
  return {
    body,
    contentType: `multipart/form-data; boundary=${boundary}`,
    digest: createHash('sha256').update(body).digest('hex'),
  }
}

export function partAttachmentMetadata(
  bytes: Buffer,
  expectedPk: string,
  wire: PartAttachmentWire,
): PartAttachmentMetadata {
  const row = responseObject(bytes)
  if (
    responsePk(row.pk) !== expectedPk ||
    row.model_type !== 'part' ||
    responsePk(row.model_id) !== wire.partPk ||
    String(row.file_size) !== wire.version.byteSize ||
    row.filename !== partAttachmentFilename(wire) ||
    row.comment !== partAttachmentComment(wire) ||
    typeof row.attachment !== 'string' ||
    !row.attachment
  ) {
    throw new Error('part_attachment_domain_changed')
  }
  return {
    pk: expectedPk,
    partPk: wire.partPk,
    path: row.attachment,
    filename: row.filename,
    comment: row.comment,
    byteSize: wire.version.byteSize,
  }
}

export function samePartAttachmentBytes(bytes: Buffer, wire: PartAttachmentWire) {
  return (
    String(bytes.length) === wire.version.byteSize &&
    createHash('sha256').update(bytes).digest('hex') === wire.version.blobDigest
  )
}
