import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  partAttachmentMultipart,
  partAttachmentMetadata,
  samePartAttachmentBytes,
} from '#/execution/attachments/part-attachment-wire.ts'
import { qualifiedAttachmentPath } from '#/inventory/transport.ts'

const bytes = Buffer.from('literal approved documentary bytes Ω')
const wire = {
  artifactKey: '10000000-0000-4000-8000-000000000001',
  partPk: '9007199254740993',
  version: {
    versionId: '20000000-0000-4000-8000-000000000002',
    evidenceId: '30000000-0000-4000-8000-000000000003',
    blobDigest: createHash('sha256').update(bytes).digest('hex'),
    byteSize: String(bytes.length),
    mediaType: 'application/pdf' as const,
    kind: 'original' as const,
    originalVersionId: '20000000-0000-4000-8000-000000000002',
    originalDigest: createHash('sha256').update(bytes).digest('hex'),
    recipeDigest: null,
  },
}

test('generic multipart binds exact approved bytes, Part content type, destination and documentary marker', () => {
  const first = partAttachmentMultipart(wire, bytes)
  const second = partAttachmentMultipart(wire, bytes)
  assert.equal(first.body.toString('hex'), second.body.toString('hex'))
  assert.equal(first.digest, createHash('sha256').update(first.body).digest('hex'))
  assert.match(first.body.toString('utf8'), /name="model_type"\r\n\r\npart\r\n/)
  assert.match(first.body.toString('utf8'), /name="model_id"\r\n\r\n9007199254740993\r\n/)
  assert.match(
    first.body.toString('utf8'),
    /name="attachment"; filename="bench-10000000-0000-4000-8000-000000000001.pdf"/,
  )
  assert.equal(first.body.indexOf(bytes) > 0, true)
  assert.throws(() => partAttachmentMultipart(wire, Buffer.from('changed')))
})

test('known metadata requires PK/model/Part/artifact/size and exact downloaded bytes', () => {
  const value = {
    pk: '17',
    model_type: 'part',
    model_id: wire.partPk,
    filename: 'bench-10000000-0000-4000-8000-000000000001.pdf',
    comment: 'Bench Intake artifact 10000000-0000-4000-8000-000000000001',
    file_size: bytes.length,
    attachment: '/media/attachments/17.pdf',
  }
  assert.equal(
    partAttachmentMetadata(Buffer.from(JSON.stringify(value)), '17', wire).partPk,
    wire.partPk,
  )
  for (const changed of [
    { model_id: '93' },
    { model_type: 'stock.stockitem' },
    { pk: '18' },
    { file_size: 1 },
    { comment: 'matching filename only' },
  ]) {
    assert.throws(() =>
      partAttachmentMetadata(Buffer.from(JSON.stringify({ ...value, ...changed })), '17', wire),
    )
  }
  assert.equal(samePartAttachmentBytes(bytes, wire), true)
  assert.equal(samePartAttachmentBytes(Buffer.from('changed'), wire), false)
})

test('only normalized same-origin qualified media paths pass; redirects/external/token/traversal spellings cannot be requested', () => {
  const origin = new URL('http://127.0.0.1:12345')
  assert.equal(
    qualifiedAttachmentPath('/media/attachments/17.pdf', origin),
    '/media/attachments/17.pdf',
  )
  assert.equal(
    qualifiedAttachmentPath('http://127.0.0.1:12345/media/attachments/17.pdf', origin),
    '/media/attachments/17.pdf',
  )
  for (const path of [
    'https://outside.invalid/media/attachments/17.pdf',
    '//outside.invalid/media/attachments/17.pdf',
    '/media/attachments/../private',
    '/media/attachments/%2e%2e/private',
    '/media/attachments/17.pdf?token=secret',
    '/api/part/93/',
    '/media/attachments/17.pdf#fragment',
    'http://user:password@127.0.0.1:12345/media/attachments/17.pdf',
    '/media/attachments\\private',
  ]) {
    assert.throws(() => qualifiedAttachmentPath(path, origin), path)
  }
})
