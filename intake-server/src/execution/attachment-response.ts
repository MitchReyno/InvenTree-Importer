import { assertAttachmentReceipt, type AttachmentReceiptDto } from '@invimport/contracts/media'
import { strictJson } from '@invimport/contracts/json'
import type { AttachmentWire } from '../inventory/transport.ts'
import { responsePk } from './response.ts'

export function attachmentReceipt(bytes: Buffer): AttachmentReceiptDto {
  const value = strictJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  assertAttachmentReceipt(value)
  responsePk(value.stock)
  if ('pk' in value) {
    responsePk(value.pk)
  }
  return value
}

export function receiptMatches(receipt: AttachmentReceiptDto, expected: AttachmentWire) {
  const sameArtifact = receipt.artifact === expected.artifactKey
  const sameDestination = receipt.stock === expected.stockPk
  const exactBytes = receipt.sha256 === expected.digest && receipt.byte_size === expected.byteSize
  return sameArtifact && sameDestination && exactBytes && receipt.media_type === expected.mediaType
}
