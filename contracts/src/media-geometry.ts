import type { MediaRecipeDto, RotatedMediaRecipeDto } from './media.ts'

export const MEDIA_MICRO_PIXELS = 1_000_000

export function regionTrigonometry(millidegrees: number) {
  switch (millidegrees) {
    case 0:
      return { cosine: 1, sine: 0 }
    case 90000:
      return { cosine: 0, sine: 1 }
    case 180000:
      return { cosine: -1, sine: 0 }
    case 270000:
      return { cosine: 0, sine: -1 }
    default: {
      const radians = (millidegrees * Math.PI) / 180000
      return { cosine: Math.cos(radians), sine: Math.sin(radians) }
    }
  }
}

/** Edge coordinates describe the fixed image; the selected rectangle alone rotates. */
export function rotatedMediaRegion(recipe: RotatedMediaRecipeDto) {
  const centerX = Number(recipe.center_x_micro) / MEDIA_MICRO_PIXELS
  const centerY = Number(recipe.center_y_micro) / MEDIA_MICRO_PIXELS
  const width = Number(recipe.width_micro) / MEDIA_MICRO_PIXELS
  const height = Number(recipe.height_micro) / MEDIA_MICRO_PIXELS
  if (
    width <= 0 ||
    height <= 0 ||
    recipe.output_width !== Math.max(1, Math.floor(width + 0.5)) ||
    recipe.output_height !== Math.max(1, Math.floor(height + 0.5))
  ) {
    throw new Error('invalid_rotated_region_dimensions')
  }
  const { cosine, sine } = regionTrigonometry(recipe.rotation_millidegrees)
  const corners = [-1, 1].flatMap((horizontal) =>
    [-1, 1].map((vertical) => ({
      x: centerX + (cosine * horizontal * width) / 2 - (sine * vertical * height) / 2,
      y: centerY + (sine * horizontal * width) / 2 + (cosine * vertical * height) / 2,
    })),
  )
  const tolerance = 1e-9
  if (
    corners.some(
      (corner) =>
        corner.x < -tolerance ||
        corner.y < -tolerance ||
        corner.x > recipe.source_width + tolerance ||
        corner.y > recipe.source_height + tolerance,
    )
  ) {
    throw new Error('rotated_region_outside_source')
  }
  if (recipe.aspect_ratio) {
    const difference =
      BigInt(recipe.width_micro) * BigInt(recipe.aspect_ratio.height) -
      BigInt(recipe.height_micro) * BigInt(recipe.aspect_ratio.width)
    const toleranceMicro = BigInt(recipe.aspect_ratio.width + recipe.aspect_ratio.height)
    if (difference > toleranceMicro || difference < -toleranceMicro) {
      throw new Error('rotated_region_aspect_changed')
    }
  }
  return { centerX, centerY, width, height, cosine, sine, corners }
}

export function requireMediaRecipeBounds(recipe: MediaRecipeDto) {
  if (recipe.version === 'documentary-rotated-region/1') {
    rotatedMediaRegion(recipe)
  } else if (
    recipe.x + recipe.width > recipe.source_width ||
    recipe.y + recipe.height > recipe.source_height
  ) {
    throw new Error('crop_outside_source')
  }
}
