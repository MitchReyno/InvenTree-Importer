import sharp from 'sharp'
import type { CreateRaw, OutputInfo } from 'sharp'
import { rotatedMediaRegion, type RotatedMediaRecipeDto } from '@invimport/contracts/media'
import { MEDIA_LIMITS, type DecodedPage } from './decoder-protocol.ts'

export class RotatedRegionLimitError extends Error {}

/** libvips default canvas bounds round signed values to nearest, ties away from zero. */
function roundVipsBound(value: number) {
  return Math.sign(value) * Math.floor(Math.abs(value) + 0.5)
}

/** An image for sharp to read: encoded bytes, or raw pixels with their layout. */
export interface WindowSource {
  input: Buffer
  raw?: CreateRaw
  width: number
  height: number
}

/**
 * A rectangle on the source, in source pixels, turned about its centre. The rotation follows
 * `rotatedMediaRegion`: corners lie at the centre plus the half sizes turned by (cosine, sine).
 */
export interface RotatedWindow {
  centerX: number
  centerY: number
  width: number
  height: number
  cosine: number
  sine: number
}

/**
 * Samples a turned window of the source into an upright raster of the output size with bicubic
 * interpolation, scaling each axis to fit. Returns raw pixels with the source's channels.
 */
export async function sampleRotatedWindow(
  source: WindowSource,
  window: RotatedWindow,
  output: { width: number; height: number },
): Promise<{ data: Buffer; info: OutputInfo }> {
  const horizontalScale = output.width / window.width
  const verticalScale = output.height / window.height
  const matrix: [[number, number], [number, number]] = [
    [horizontalScale * window.cosine, horizontalScale * window.sine],
    [-verticalScale * window.sine, verticalScale * window.cosine],
  ]
  const transformedCorners = [
    { x: 0, y: 0 },
    { x: source.width, y: 0 },
    { x: 0, y: source.height },
    { x: source.width, y: source.height },
  ].map((corner) => ({
    x: matrix[0][0] * corner.x + matrix[0][1] * corner.y,
    y: matrix[1][0] * corner.x + matrix[1][1] * corner.y,
  }))
  const minimumX = Math.min(...transformedCorners.map((corner) => corner.x))
  const minimumY = Math.min(...transformedCorners.map((corner) => corner.y))
  const maximumX = Math.max(...transformedCorners.map((corner) => corner.x))
  const maximumY = Math.max(...transformedCorners.map((corner) => corner.y))
  const intermediateWidth = roundVipsBound(maximumX - minimumX)
  const intermediateHeight = roundVipsBound(maximumY - minimumY)
  if (
    intermediateWidth * intermediateHeight > MEDIA_LIMITS.totalPixels ||
    output.width * output.height > MEDIA_LIMITS.pixels
  ) {
    throw new RotatedRegionLimitError('rotated_region_pixel_limit')
  }
  const intermediate = await sharp(source.input, {
    limitInputPixels: MEDIA_LIMITS.pixels,
    raw: source.raw,
  })
    .affine(matrix, {
      idx: -(window.centerX - 0.5),
      idy: -(window.centerY - 0.5),
      odx: (output.width - 1) / 2 + roundVipsBound(minimumX),
      ody: (output.height - 1) / 2 + roundVipsBound(minimumY),
      interpolator: sharp.interpolators.bicubic,
      background: '#ffffff',
    })
    .raw()
    .toBuffer({ resolveWithObject: true })
  if (
    intermediate.info.width !== intermediateWidth ||
    intermediate.info.height !== intermediateHeight
  ) {
    throw new Error('rotated_region_native_bounds_changed')
  }
  return sharp(intermediate.data, { raw: intermediate.info })
    .extract({ left: 0, top: 0, width: output.width, height: output.height })
    .raw()
    .toBuffer({ resolveWithObject: true })
}

export async function decodeRotatedRegion(
  source: DecodedPage,
  recipe: RotatedMediaRecipeDto,
): Promise<DecodedPage> {
  const region = rotatedMediaRegion(recipe)
  const output = { width: recipe.output_width, height: recipe.output_height }
  const sampled = await sampleRotatedWindow(
    { input: source.bytes, width: source.width, height: source.height },
    region,
    output,
  )
  const bytes = await sharp(sampled.data, { raw: sampled.info })
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer()
  if (bytes.length > MEDIA_LIMITS.outputBytes) {
    throw new RotatedRegionLimitError('rotated_region_output_limit')
  }
  return { page: 1, ...output, bytes }
}
