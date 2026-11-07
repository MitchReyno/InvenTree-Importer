import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import type { EvidenceRegionDto } from '@invimport/contracts'
import { canonicalRecord } from '@invimport/contracts/json'
import { renditionDimensions, type MediaRenditionSize } from '@invimport/contracts/media'
import { CaptureError } from '../capture/repository.ts'

type PixelRegion = Extract<EvidenceRegionDto, { kind: 'pixels' }>

/**
 * Region crops are cut from the already-decoded preview PNG, never the original upload, so
 * untrusted originals stay inside the decoder boundary. They are cached in a private directory
 * outside the blob store, keyed by version, page and region, and are never evidence versions.
 */
export function regionCropCache(directory: string) {
  return {
    /**
     * The region cut from the full-resolution page, then resized to the size's exact dimensions.
     * A region no larger than the size is returned unscaled, as PNG.
     */
    async crop(
      key: { versionId: string; page: number },
      region: PixelRegion,
      preview: () => Promise<Buffer>,
      size: MediaRenditionSize | 'full' = 'full',
    ): Promise<{ bytes: Buffer; mediaType: 'image/png' | 'image/webp' }> {
      const target = size === 'full' ? null : renditionDimensions(region.width, region.height, size)
      const mediaType = target ? 'image/webp' : 'image/png'
      const digest = createHash('sha256').update(canonicalRecord(region)).digest('hex')
      const name = `${key.versionId}-${key.page}-${digest}-${target ? size : 'full'}`
      const path = join(directory, `${name}.${target ? 'webp' : 'png'}`)
      try {
        return { bytes: await readFile(path), mediaType }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error
        }
      }
      const source = sharp(await preview(), { limitInputPixels: false })
      const { width, height } = await source.metadata()
      if (width !== region.source_width || height !== region.source_height) {
        // The page was re-rendered at another size; the region no longer applies.
        throw new CaptureError(409, 'region_preview_mismatch')
      }
      const cut = source.extract({
        left: region.x,
        top: region.y,
        width: region.width,
        height: region.height,
      })
      const bytes = await (
        target
          ? cut
              .resize({ width: target.width, height: target.height, fit: 'fill' })
              .webp({ quality: 80, effort: 4 })
          : cut.png()
      ).toBuffer()
      await mkdir(directory, { recursive: true, mode: 0o700 })
      // A unique staging name, so concurrent crops of one region cannot rename each other's file.
      const staging = `${path}.${randomUUID()}.tmp`
      await writeFile(staging, bytes, { mode: 0o600 })
      await rename(staging, path)
      return { bytes, mediaType }
    },
  }
}
