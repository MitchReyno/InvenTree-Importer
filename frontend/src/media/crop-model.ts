import { requireMediaRecipeBounds, type RotatedMediaRecipeDto } from '@invimport/contracts/media'
import type { MediaVersionDto, MediaEditDto } from '@invimport/contracts'

export interface CropFrame {
  centerX: number
  centerY: number
  width: number
  height: number
  degrees: number
}

export type CropAspect = 'free' | '1:1' | '4:3' | '3:2' | '16:9'

export function cropAspect(value: CropAspect) {
  if (value === 'free') {
    return null
  }
  const [width, height] = value.split(':').map(Number)
  return { width, height }
}

export function cropRecipe(
  version: MediaVersionDto,
  pageNumber: number,
  frame: CropFrame,
  aspect: CropAspect,
): RotatedMediaRecipeDto {
  const page = version.pages.find((item) => item.page === pageNumber)
  if (!page || !Object.values(frame).every(Number.isFinite)) {
    throw new Error('invalid_crop_frame')
  }
  const angle = ((Math.round(frame.degrees * 1000) % 360000) + 360000) % 360000
  const recipe: RotatedMediaRecipeDto = {
    version: 'documentary-rotated-region/1',
    source_version_id: version.id,
    source_digest: version.digest,
    page: pageNumber,
    source_width: page.width,
    source_height: page.height,
    center_x_micro: String(Math.round(frame.centerX * 1000000)),
    center_y_micro: String(Math.round(frame.centerY * 1000000)),
    width_micro: String(Math.round(frame.width * 1000000)),
    height_micro: String(Math.round(frame.height * 1000000)),
    rotation_millidegrees: angle,
    output_width: Math.max(1, Math.floor(frame.width + 0.5)),
    output_height: Math.max(1, Math.floor(frame.height + 0.5)),
    aspect_ratio: cropAspect(aspect),
  }
  requireMediaRecipeBounds(recipe)
  return recipe
}

export function sameRotatedRecipe(left: RotatedMediaRecipeDto, right: RotatedMediaRecipeDto) {
  const sameSource =
    left.source_version_id === right.source_version_id &&
    left.source_digest === right.source_digest &&
    left.page === right.page &&
    left.source_width === right.source_width &&
    left.source_height === right.source_height
  const sameFrame =
    left.center_x_micro === right.center_x_micro &&
    left.center_y_micro === right.center_y_micro &&
    left.width_micro === right.width_micro &&
    left.height_micro === right.height_micro &&
    left.rotation_millidegrees === right.rotation_millidegrees
  const sameOutput =
    left.output_width === right.output_width && left.output_height === right.output_height
  const sameAspect =
    left.aspect_ratio?.width === right.aspect_ratio?.width &&
    left.aspect_ratio?.height === right.aspect_ratio?.height
  return sameSource && sameFrame && sameOutput && sameAspect
}

export interface CropForm {
  frame: CropFrame
  aspect: CropAspect
}

export interface CropIntent {
  key: string
  derivationId: string
  recipe: RotatedMediaRecipeDto
  input: MediaEditDto
}
