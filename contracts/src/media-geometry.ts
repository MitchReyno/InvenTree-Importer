import type { MediaRecipeDto, MediaViewRecipeDto, RotatedMediaRecipeDto } from './media.ts'
import {
  VIEW_MAX_LONG_EDGE,
  VIEW_MAX_ZOOM,
  VIEW_MIN_LONG_EDGE,
  VIEW_THUMB_LONG_EDGE,
} from './media.ts'

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

/**
 * Where a view samples its page and the sizes it renders at. The sampling window is the region
 * turned against the straightening angle about its centre; the corner guard shrinks it evenly
 * until every corner lies on the page, so a straightened view never shows blank corners. Quarter
 * turns apply after straightening. `scale` is rendered pixels per page pixel.
 */
export interface ViewLayout {
  centerX: number
  centerY: number
  /** The window's size in page pixels, before quarter turns. */
  windowWidth: number
  windowHeight: number
  /** Content turns clockwise by this, in millidegrees; the window turns the other way. */
  straightenMillidegrees: number
  /** The corner guard's factor, at most 1. */
  guard: number
  scale: number
  width: number
  height: number
  thumbWidth: number
  thumbHeight: number
}

export function viewLayout(
  recipe: Pick<MediaViewRecipeDto, 'page_width' | 'page_height' | 'view'>,
): ViewLayout {
  const { region, quarter_turns: quarterTurns, straighten_millidegrees: angle } = recipe.view
  if (
    region.x + region.width > recipe.page_width ||
    region.y + region.height > recipe.page_height
  ) {
    throw new Error('view_region_outside_page')
  }
  const centerX = region.x + region.width / 2
  const centerY = region.y + region.height / 2
  const { cosine, sine } = regionTrigonometry(Math.abs(angle))
  const halfWidthNeeded = (region.width * cosine + region.height * sine) / 2
  const halfHeightNeeded = (region.width * sine + region.height * cosine) / 2
  const guard = Math.min(
    1,
    Math.min(centerX, recipe.page_width - centerX) / halfWidthNeeded,
    Math.min(centerY, recipe.page_height - centerY) / halfHeightNeeded,
  )
  const windowWidth = region.width * guard
  const windowHeight = region.height * guard
  const turned = quarterTurns % 2 === 1
  const shownWidth = turned ? windowHeight : windowWidth
  const shownHeight = turned ? windowWidth : windowHeight
  const longEdge = Math.max(shownWidth, shownHeight)
  const scale =
    longEdge > VIEW_MAX_LONG_EDGE
      ? VIEW_MAX_LONG_EDGE / longEdge
      : Math.min(VIEW_MAX_ZOOM, Math.max(1, VIEW_MIN_LONG_EDGE / longEdge))
  const width = Math.max(1, Math.round(shownWidth * scale))
  const height = Math.max(1, Math.round(shownHeight * scale))
  const thumbScale = Math.min(1, VIEW_THUMB_LONG_EDGE / Math.max(width, height))
  return {
    centerX,
    centerY,
    windowWidth,
    windowHeight,
    straightenMillidegrees: angle,
    guard,
    scale,
    width,
    height,
    thumbWidth: Math.max(1, Math.round(width * thumbScale)),
    thumbHeight: Math.max(1, Math.round(height * thumbScale)),
  }
}
