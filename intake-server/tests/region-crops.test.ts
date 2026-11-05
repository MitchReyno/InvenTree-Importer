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
    const meta = await sharp(first).metadata()
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
