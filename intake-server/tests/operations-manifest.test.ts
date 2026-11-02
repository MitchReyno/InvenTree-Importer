import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canonical, strictJson } from '@invimport/contracts/json'
import { decodeArchiveManifest, MAX_MANIFEST_BYTES } from '../src/operations/archive-model.ts'

test('supported archive manifests above the HTTP JSON limit round-trip under their own bounded parser', () => {
  const manifest = {
    format: 'bench-intake-archive/1',
    database_sha256: 'a'.repeat(64),
    external_binding_sha256: 'b'.repeat(64),
    store_id: '10000000-0000-4000-8000-000000000001',
    blobs: Array.from({ length: 4000 }, (_, index) => ({
      digest: index.toString(16).padStart(64, '0'),
      size: '1',
    })),
    migrations: [{ name: '0001_foundation.sql', sha256: 'c'.repeat(64) }],
    scheduler: 'same-database',
    credentials: 'excluded',
    activation: 'externally-disabled',
  }
  const bytes = Buffer.from(canonical(manifest) + '\n')
  assert.ok(bytes.length > 262144 && bytes.length < MAX_MANIFEST_BYTES)
  assert.throws(() => strictJson(bytes.toString('utf8')), /json_too_large/)
  assert.deepEqual(decodeArchiveManifest(bytes), manifest)
  assert.throws(
    () => decodeArchiveManifest(Buffer.alloc(MAX_MANIFEST_BYTES + 1, 32)),
    /json_too_large/,
  )
  assert.throws(() => decodeArchiveManifest(Buffer.from([0xff])), /encoded data/)
})
