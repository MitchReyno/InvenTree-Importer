import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { regionCropCache } from '../src/media/region-crops.ts'

test('a region crop is cut from the preview once and then served from the private cache', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'region-crops-'))
  try {
    const preview = await sharp({
      create: { width: 40, height: 20, channels: 3, background: { r: 10, g: 200, b: 30 } },
    })
      .png()
      .toBuffer()
    let reads = 0
    const cache = regionCropCache(join(directory, 'crops'))
    const region = {
      kind: 'pixels' as const,
      x: 5,
      y: 2,
      width: 10,
      height: 8,
      source_width: 40,
      source_height: 20,
    }
    const read = async () => {
      reads += 1
      return preview
    }
    const first = await cache.crop({ versionId: 'v1', page: 1 }, region, read)
    const again = await cache.crop({ versionId: 'v1', page: 1 }, region, read)
    assert.deepEqual(again, first)
    assert.equal(reads, 1)
    const meta = await sharp(first.bytes).metadata()
    assert.deepEqual([meta.width, meta.height], [10, 8])
    assert.equal((await readdir(join(directory, 'crops'))).length, 1)
    await assert.rejects(
      cache.crop({ versionId: 'v2', page: 1 }, { ...region, source_width: 41 }, read),
      /region_preview_mismatch/,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('a sized crop is cut at full resolution, then resized to the exact shared dimensions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'region-crops-sized-'))
  try {
    const preview = await sharp({
      create: { width: 4000, height: 3000, channels: 3, background: { r: 90, g: 60, b: 30 } },
    })
      .png()
      .toBuffer()
    const cache = regionCropCache(join(directory, 'crops'))
    const read = async () => preview
    const large = {
      kind: 'pixels' as const,
      x: 100,
      y: 200,
      width: 1800,
      height: 1200,
      source_width: 4000,
      source_height: 3000,
    }
    const thumb = await cache.crop({ versionId: 'v1', page: 1 }, large, read, 'thumb')
    assert.equal(thumb.mediaType, 'image/webp')
    const thumbMeta = await sharp(thumb.bytes).metadata()
    assert.deepEqual([thumbMeta.format, thumbMeta.width, thumbMeta.height], ['webp', 320, 213])
    const full = await cache.crop({ versionId: 'v1', page: 1 }, large, read)
    assert.equal(full.mediaType, 'image/png')
    assert.deepEqual([(await sharp(full.bytes).metadata()).width], [1800])
    // Each size is its own cache entry.
    assert.equal((await readdir(join(directory, 'crops'))).length, 2)

    const small = { ...large, width: 200, height: 150 }
    const unscaled = await cache.crop({ versionId: 'v1', page: 1 }, small, read, 'card')
    assert.equal(unscaled.mediaType, 'image/png')
    const smallMeta = await sharp(unscaled.bytes).metadata()
    assert.deepEqual([smallMeta.width, smallMeta.height], [200, 150])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('the crop revision changes with the version, page or region', async () => {
  const { observationCropRevision } = await import('@invimport/contracts/media')
  const version = '00000000-0000-4000-8000-000000000001'
  const region = { x: 1, y: 2, width: 30, height: 40 }
  const base = observationCropRevision(version, 1, region)
  assert.match(base, /^[a-f0-9-]{36}(-\d{1,9}){5}$/)
  assert.notEqual(observationCropRevision(version, 2, region), base)
  assert.notEqual(observationCropRevision(version, 1, { ...region, x: 2 }), base)
  assert.notEqual(observationCropRevision('00000000-0000-4000-8000-000000000002', 1, region), base)
})
