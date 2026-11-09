import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { requireBoundedClosure } from '#/review/media-material.ts'
import type { MediaInputs, MediaInputVersion } from '#/media/inputs.ts'

function version(byteSize = '10'): MediaInputVersion {
  return {
    versionId: randomUUID(),
    evidenceId: randomUUID(),
    kind: 'original',
    digest: 'a'.repeat(64),
    byteSize,
    mediaType: 'image/png',
    recipe: null,
  }
}

function inputs(versions: MediaInputVersion[]): Map<string, MediaInputs> {
  return new Map([[randomUUID(), { versions } as unknown as MediaInputs]])
}

test('a new supplier logo counts toward the 64-version and 256 MiB approved closure', () => {
  const linked = Array.from({ length: 64 }, () => version())
  assert.equal(requireBoundedClosure(inputs(linked)), true)
  assert.equal(requireBoundedClosure(inputs(linked), [version()]), false, 'one more version')
  assert.equal(requireBoundedClosure(inputs(linked), [linked[0]]), true, 'shared logo counts once')
  const large = [version(String(256 * 1024 * 1024 - 10))]
  assert.equal(requireBoundedClosure(inputs(large), [version('10')]), true)
  assert.equal(requireBoundedClosure(inputs(large), [version('11')]), false, 'byte boundary')
})
