import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validate } from '@invimport/contracts'
import { mediaInputManifest, researchInputManifest, sealed } from '#/processing/model.ts'
import { processingInputIsCurrent } from '#/processing/authority.ts'
import { processingProfiles } from '#/processing/policy.ts'
import { manualInputFixture, emptyProcessingMedia } from './support/processing-input.ts'

test('restricted input is additive and seals canonical admitted URLs without changing metadata-only input', () => {
  const capture = manualInputFixture()
  const media = emptyProcessingMedia(capture, capture.lots[0].id)
  const descriptor = { manifest: media.bytes.toString(), sha256: media.digest.toString('hex') }
  const original = mediaInputManifest(capture, capture.lots[0].id, 'research', [], null, descriptor)
  const originalBytes = sealed(original).bytes
  const restricted = researchInputManifest(
    capture,
    capture.lots[0].id,
    'research',
    [],
    null,
    descriptor,
    ['https://EXAMPLE.com/z', 'https://example.com/a', 'https://example.com/z'],
  )
  validate('ProcessingInputV3', restricted)
  assert.deepEqual(restricted.source_urls, ['https://example.com/a', 'https://example.com/z'])
  assert.equal(restricted.tool_profile_version, 'restricted-research-tools/1')
  assert.equal(original.tool_profile_version, 'restricted-no-tools/1')
  assert.deepEqual(sealed(original).bytes, originalBytes)
  assert.notEqual(restricted.instruction_sha256, original.instruction_sha256)
  assert.equal(
    processingProfiles[restricted.profile_id].commandSchemaVersion,
    'bench-intake-processing-command/3',
  )
})

test('source admission removal makes a restricted input stale while additions cannot rewrite its authority', () => {
  const capture = manualInputFixture()
  const media = emptyProcessingMedia(capture, capture.lots[0].id)
  const url = 'https://example.com/datasheet'
  const manifest = researchInputManifest(
    capture,
    capture.lots[0].id,
    'research',
    [],
    null,
    {
      manifest: media.bytes.toString(),
      sha256: media.digest.toString('hex'),
    },
    [url],
  )
  const bytes = sealed(manifest).bytes
  assert.equal(processingInputIsCurrent(manifest, capture, media, [url]), true)
  assert.equal(
    processingInputIsCurrent(manifest, capture, media, [url, 'https://other.example/new']),
    true,
  )
  assert.equal(processingInputIsCurrent(manifest, capture, media, []), false)
  assert.deepEqual(sealed(manifest).bytes, bytes)
  assert.throws(
    () =>
      researchInputManifest(
        capture,
        capture.lots[0].id,
        'research',
        [],
        null,
        {
          manifest: media.bytes.toString(),
          sha256: media.digest.toString('hex'),
        },
        ['https://user:secret@example.com/'],
      ),
    /processing_source_policy_invalid/,
  )
})
