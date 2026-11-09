import sharp from 'sharp'
import { rotatedMediaRegion, type RotatedMediaRecipeDto } from '@invimport/contracts/media'
import { MEDIA_LIMITS, type DecodedPage } from './decoder-protocol.ts'

export class RotatedRegionLimitError extends Error {}

/** libvips default canvas bounds round signed values to nearest, ties away from zero. */
function roundVipsBound(value: number) {
  return Math.sign(value) * Math.floor(Math.abs(value) + 0.5)
}

export async function decodeRotatedRegion(
  source: DecodedPage,
  recipe: RotatedMediaRecipeDto,
): Promise<DecodedPage> {
  const region = rotatedMediaRegion(recipe)
  const horizontalScale = recipe.output_width / region.width
  const verticalScale = recipe.output_height / region.height
  const matrix: [[number, number], [number, number]] = [
    [horizontalScale * region.cosine, horizontalScale * region.sine],
    [-verticalScale * region.sine, verticalScale * region.cosine],
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
    recipe.output_width * recipe.output_height > MEDIA_LIMITS.pixels
  ) {
    throw new RotatedRegionLimitError('rotated_region_pixel_limit')
  }
  const intermediate = await sharp(source.bytes, { limitInputPixels: MEDIA_LIMITS.pixels })
    .affine(matrix, {
      idx: -(region.centerX - 0.5),
      idy: -(region.centerY - 0.5),
      odx: (recipe.output_width - 1) / 2 + roundVipsBound(minimumX),
      ody: (recipe.output_height - 1) / 2 + roundVipsBound(minimumY),
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
  const bytes = await sharp(intermediate.data, { raw: intermediate.info })
    .extract({ left: 0, top: 0, width: recipe.output_width, height: recipe.output_height })
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer()
  if (bytes.length > MEDIA_LIMITS.outputBytes) {
    throw new RotatedRegionLimitError('rotated_region_output_limit')
  }
  return { page: 1, width: recipe.output_width, height: recipe.output_height, bytes }
}
