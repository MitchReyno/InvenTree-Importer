import { sha256 } from '../db/authority.ts'
import { attachmentReceipt, receiptMatches } from './attachment-response.ts'
import type { AttachmentWire } from '../inventory/transport.ts'

export const ATTACHMENT_HEADER_BYTES = 8192
export const ATTACHMENT_CONTENT_BYTES = 20 * 1024 * 1024
export const ATTACHMENT_RESPONSE_BYTES = ATTACHMENT_CONTENT_BYTES + ATTACHMENT_HEADER_BYTES

/** One target response binds domain metadata and bytes from the same retained file row. */
export function verifiedAttachmentFrame(
  frame: Buffer,
  expected: AttachmentWire,
  expectedPk: string,
) {
  const headerEnd = frame.indexOf(10)
  if (headerEnd < 0 || headerEnd > ATTACHMENT_HEADER_BYTES) {
    throw new Error('invalid_attachment_frame')
  }
  const receipt = attachmentReceipt(frame.subarray(0, headerEnd))
  if (!('pk' in receipt) || receipt.pk !== expectedPk || !receiptMatches(receipt, expected)) {
    throw new Error('attachment_domain_changed')
  }
  const bytes = frame.subarray(headerEnd + 1)
  if (bytes.length > ATTACHMENT_CONTENT_BYTES || String(bytes.length) !== expected.byteSize) {
    throw new Error('attachment_content_size_changed')
  }
  const digest = sha256(bytes)
  if (digest.toString('hex') !== expected.digest) {
    throw new Error('attachment_content_changed')
  }
  return { receipt, digest }
}
