import {
  MEDIA_STOCK_IMAGES_MAX,
  type MediaEditDto,
  type MediaLitViewRecipeDto,
  type ProcessingImageCropDto,
  type ProcessingImageSelectionDto,
  type ProcessingImageSelectionItemDto,
  type ProcessingImagesProposalDto,
  type ProcessingImagesReviewDto,
} from '@invimport/contracts'

type CropRole = ProcessingImageCropDto['role']

/** Which crops the operator means to confirm: at most one Part image, and stock images. */
export type ImageChoices = {
  partIndex: number | null
  stockIndexes: readonly number[]
}

/** Where a confirmed image of the lot sits: the Part image, or a stock image counted from 1. */
export type ConfirmedPlacement =
  | { kind: 'part'; state: DerivationState }
  | { kind: 'stock'; position: number; state: DerivationState }

export type DerivationState = 'preparing' | 'ready' | 'failed'

export const ROLE_LABEL: Record<CropRole, string> = {
  part_image: 'Part image',
  stock_image: 'Stock image',
  extra: 'Extra',
}

const QUARTER_TURN_LABEL = ['', '¼ turn', '½ turn', '¾ turn']

const MILLIDEGREES_PER_DEGREE = 1000
const THOUSANDTHS = 1000

/** Each lot's newest proposal, in the order the read lists them (newest first). */
export function newestProposals(review: ProcessingImagesReviewDto) {
  const byLot = new Map<string, ProcessingImagesProposalDto>()
  for (const proposal of review.proposals) {
    if (!byLot.has(proposal.lot_id)) {
      byLot.set(proposal.lot_id, proposal)
    }
  }
  return [...byLot.values()]
}

/** Two `/2` recipes describe the same crop; the read may order their fields differently. */
export function sameLitRecipe(left: MediaLitViewRecipeDto, right: MediaLitViewRecipeDto) {
  const sameSource =
    left.version === right.version &&
    left.source_version_id === right.source_version_id &&
    left.source_digest === right.source_digest &&
    left.page === right.page &&
    left.page_width === right.page_width &&
    left.page_height === right.page_height
  const sameRegion =
    left.view.region.x === right.view.region.x &&
    left.view.region.y === right.view.region.y &&
    left.view.region.width === right.view.region.width &&
    left.view.region.height === right.view.region.height
  const sameTurn =
    left.view.quarter_turns === right.view.quarter_turns &&
    left.view.straighten_millidegrees === right.view.straighten_millidegrees
  const sameLight =
    left.light.white_balance === right.light.white_balance &&
    left.light.contrast_clip_permille === right.light.contrast_clip_permille &&
    left.light.gamma_thousandths === right.light.gamma_thousandths &&
    left.light.sharpen === right.light.sharpen

  return sameSource && sameRegion && sameTurn && sameLight
}

/**
 * The choices a lot's review starts from: its confirmed images when it has a selection, else the
 * first Part image crop and every stock crop.
 */
export function defaultChoices(
  proposal: ProcessingImagesProposalDto,
  selection: ProcessingImageSelectionDto | undefined,
): ImageChoices {
  const partCrops = proposal.crops.filter((crop) => crop.role === 'part_image')
  const stockCrops = proposal.crops.filter((crop) => crop.role === 'stock_image')
  if (!selection) {
    return {
      partIndex: partCrops[0]?.index ?? null,
      stockIndexes: stockCrops.map((crop) => crop.index),
    }
  }
  const confirmedPart = selection.part_image
  const part = confirmedPart
    ? partCrops.find((crop) => sameLitRecipe(crop.recipe, confirmedPart.recipe))
    : undefined
  const stock = stockCrops.filter((crop) =>
    selection.stock_images.some((item) => sameLitRecipe(crop.recipe, item.recipe)),
  )

  return { partIndex: part?.index ?? null, stockIndexes: stock.map((crop) => crop.index) }
}

/** The media edit that confirms these choices; stock images keep the proposal's order. */
export function selectImagesChange(
  proposal: ProcessingImagesProposalDto,
  choices: ImageChoices,
): MediaEditDto['change'] {
  const part = proposal.crops.find(
    (crop) => crop.role === 'part_image' && crop.index === choices.partIndex,
  )
  const stock = proposal.crops.filter(
    (crop) => crop.role === 'stock_image' && choices.stockIndexes.includes(crop.index),
  )

  return {
    kind: 'select_images',
    subject_id: proposal.lot_id,
    part_image: part?.recipe ?? null,
    stock_images: stock.map((crop) => crop.recipe),
  }
}

export function tooManyStockImages(choices: ImageChoices) {
  return choices.stockIndexes.length > MEDIA_STOCK_IMAGES_MAX
}

function derivationState(state: ProcessingImageSelectionItemDto['state']): DerivationState {
  if (state === 'ready') {
    return 'ready'
  }
  if (state === 'queued') {
    return 'preparing'
  }
  return 'failed'
}

/** Where this crop already sits among the lot's confirmed images, if it does. */
export function confirmedPlacement(
  crop: ProcessingImageCropDto,
  selection: ProcessingImageSelectionDto | undefined,
): ConfirmedPlacement | null {
  if (!selection) {
    return null
  }
  if (selection.part_image && sameLitRecipe(selection.part_image.recipe, crop.recipe)) {
    return { kind: 'part', state: derivationState(selection.part_image.state) }
  }
  const position = selection.stock_images.findIndex((item) =>
    sameLitRecipe(item.recipe, crop.recipe),
  )
  if (position === -1) {
    return null
  }
  return {
    kind: 'stock',
    position: position + 1,
    state: derivationState(selection.stock_images[position].state),
  }
}

/** Confirmed images that none of this proposal's crops describe; confirming replaces them. */
export function confirmedElsewhere(
  proposal: ProcessingImagesProposalDto,
  selection: ProcessingImageSelectionDto | undefined,
) {
  if (!selection) {
    return 0
  }
  const items = selection.part_image
    ? [selection.part_image, ...selection.stock_images]
    : selection.stock_images
  const unmatched = items.filter(
    (item) => !proposal.crops.some((crop) => sameLitRecipe(crop.recipe, item.recipe)),
  )
  return unmatched.length
}

function signedDegrees(millidegrees: number) {
  const degrees = (Math.abs(millidegrees) / MILLIDEGREES_PER_DEGREE).toFixed(1)
  const sign = millidegrees < 0 ? '−' : '+'

  return `${sign}${degrees}°`
}

/** What the recipe does besides cutting the region, in the order the app applies it. */
export function adjustmentChips(recipe: MediaLitViewRecipeDto) {
  const chips: string[] = []
  if (recipe.view.quarter_turns !== 0) {
    chips.push(QUARTER_TURN_LABEL[recipe.view.quarter_turns])
  }
  if (recipe.view.straighten_millidegrees !== 0) {
    chips.push(`straightened ${signedDegrees(recipe.view.straighten_millidegrees)}`)
  }
  if (recipe.light.white_balance) {
    chips.push('white balance')
  }
  if (recipe.light.contrast_clip_permille !== null) {
    chips.push('contrast')
  }
  if (recipe.light.gamma_thousandths !== null) {
    chips.push(`gamma ${(recipe.light.gamma_thousandths / THOUSANDTHS).toFixed(2)}`)
  }
  if (recipe.light.sharpen) {
    chips.push('sharpened')
  }
  if (chips.length === 0) {
    chips.push('no adjustments')
  }
  return chips
}

/** "From IMG_3011 · region 2210, 3120, 1400 × 1400", with the page of a document. */
export function cropSourceLine(crop: ProcessingImageCropDto) {
  const { x, y, width, height } = crop.recipe.view.region
  const region = `From ${crop.evidence_label} · region ${x}, ${y}, ${width} × ${height}`

  return crop.document ? `${region} · page ${crop.recipe.page}` : region
}

/** Why a crop shows no picture, or nothing when its rendering is ready. */
export function cropStateText(state: ProcessingImageCropDto['state']) {
  if (state === 'preparing') {
    return 'Rendering…'
  }
  if (state === 'failed') {
    return 'Couldn’t render this crop'
  }
  if (state === 'removed') {
    return 'Photo removed from Capture'
  }
  return undefined
}

/** The rendered crop's shape: the region, turned as the recipe turns it. */
export function cropAspect(recipe: MediaLitViewRecipeDto) {
  const { width, height } = recipe.view.region
  const turned = recipe.view.quarter_turns % 2 === 1

  return turned ? `${height} / ${width}` : `${width} / ${height}`
}

/** The chat message asking Images to redo one crop, naming it as the review shows it. */
export function redoMessage(crop: ProcessingImageCropDto, change: string) {
  const named = `Please redo crop ${crop.index} (${ROLE_LABEL[crop.role]}, from ${crop.evidence_label})`
  const wanted = change.trim()

  return wanted ? `${named}: ${wanted}` : `${named}.`
}
