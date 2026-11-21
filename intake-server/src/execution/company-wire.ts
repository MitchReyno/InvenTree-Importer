import { createHash } from 'node:crypto'
import type { MediaPlanEvidence } from './media-plan.ts'

/** Deterministic multipart framing binds the company fields and retained logo bytes to one intent. */
export function companyMultipart(
  operationKey: string,
  fields: Record<string, string | boolean>,
  logo: MediaPlanEvidence,
  bytes: Buffer,
) {
  if (
    String(bytes.length) !== logo.byteSize ||
    createHash('sha256').update(bytes).digest('hex') !== logo.blobDigest
  ) {
    throw new Error('approved_company_logo_bytes_changed')
  }
  let boundary = ''
  for (let counter = 0; counter < 16; counter += 1) {
    const candidate = `bench-${createHash('sha256').update(`${operationKey}:${logo.blobDigest}:${counter}`).digest('hex').slice(0, 48)}`
    if (!bytes.includes(Buffer.from(candidate))) {
      boundary = candidate
      break
    }
  }
  if (!boundary) {
    throw new Error('multipart_boundary_unavailable')
  }
  const chunks: Buffer[] = []
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${String(value)}\r\n`,
      ),
    )
  }
  const extension = logo.mediaType === 'image/jpeg' ? 'jpg' : 'png'
  chunks.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="bench-${operationKey}.${extension}"\r\nContent-Type: ${logo.mediaType}\r\n\r\n`,
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
