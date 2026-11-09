import { createHash, randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const extensions = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
])

/** Expose authorized image bytes to guest scripts, retaining the original citation for crops. */
export async function stageEvidence(
  id: string | number,
  body: string,
  directory: () => Promise<string>,
) {
  const reply = JSON.parse(body)
  const result = reply?.result
  const metadata = result?.structuredContent
  if (reply?.id !== id || result?.isError || metadata?.ok !== true) return body
  const image = result.content?.find((item: { type: string }) => item.type === 'image')
  if (!image) return body
  const extension = extensions.get(image.mimeType)
  if (!extension || typeof image.data !== 'string' || metadata.source?.kind !== 'media_version') {
    throw new Error('invalid_evidence_file')
  }
  const bytes = Buffer.from(image.data, 'base64')
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (!Array.isArray(metadata.pages) && sha256 !== metadata.source.sha256) {
    throw new Error('invalid_evidence_file')
  }
  const path = join(await directory(), randomUUID() + '.' + extension)
  await writeFile(path, bytes, { flag: 'wx', mode: 0o600 })
  metadata.local_file = { path, sha256, byte_length: bytes.length, media_type: image.mimeType }
  result.content = [{ type: 'text', text: JSON.stringify(metadata) }, image]
  return JSON.stringify(reply)
}
