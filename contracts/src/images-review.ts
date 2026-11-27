import { Type, type Static, type TProperties } from '@sinclair/typebox'
import { Id, IsoTime, Revision } from './scalars.ts'
import { MEDIA_STOCK_IMAGES_MAX, MediaDecodeState, MediaLitViewRecipe } from './media.ts'

const object = <T extends TProperties>(properties: T) =>
  Type.Object(properties, { additionalProperties: false })

/** An `images/1` proposal carries at most this many crops. */
export const IMAGES_PROPOSAL_MAX_CROPS = 10

/**
 * One crop an Images proposal names: its role, recipe and flags, and how the app's rendering of it
 * stands. A crop whose photo was removed from Capture reads as removed.
 */
export const ProcessingImageCrop = object({
  index: Type.Integer({ minimum: 1, maximum: IMAGES_PROPOSAL_MAX_CROPS }),
  role: Type.Union([
    Type.Literal('part_image'),
    Type.Literal('stock_image'),
    Type.Literal('extra'),
  ]),
  recipe: MediaLitViewRecipe,
  flags: Type.Array(Type.String({ minLength: 1, maxLength: 256 }), { maxItems: 8 }),
  state: Type.Union([
    Type.Literal('preparing'),
    Type.Literal('ready'),
    Type.Literal('failed'),
    Type.Literal('removed'),
  ]),
  evidence_id: Id,
  evidence_label: Type.String({ minLength: 1, maxLength: 256 }),
  document: Type.Boolean(),
})
/** A lot's `images/1` proposal as the Images step shows it; a stale one is kept for reference. */
export const ProcessingImagesProposal = object({
  proposal_id: Id,
  job_id: Id,
  lot_id: Id,
  summary: Type.String({ minLength: 1, maxLength: 2048 }),
  created_at: IsoTime,
  stale: Type.Boolean(),
  crops: Type.Array(ProcessingImageCrop, { minItems: 1, maxItems: IMAGES_PROPOSAL_MAX_CROPS }),
})
/** A confirmed image: the derived crop the recipe made, and how its derivation stands. */
export const ProcessingImageSelectionItem = object({
  version_id: Id,
  recipe: MediaLitViewRecipe,
  state: MediaDecodeState,
})
/** A lot's confirmed images: one Part image and its ordered stock images. */
export const ProcessingImageSelection = object({
  lot_id: Id,
  revision: Revision,
  part_image: Type.Union([ProcessingImageSelectionItem, Type.Null()]),
  stock_images: Type.Array(ProcessingImageSelectionItem, { maxItems: MEDIA_STOCK_IMAGES_MAX }),
})
/** The Images step's review: each lot's proposals, newest first, and its confirmed images. */
export const ProcessingImagesReview = object({
  proposals: Type.Array(ProcessingImagesProposal, { maxItems: 400 }),
  selections: Type.Array(ProcessingImageSelection, { maxItems: 200 }),
})

export const imagesReviewSchemas = {
  ProcessingImageCrop,
  ProcessingImagesProposal,
  ProcessingImageSelectionItem,
  ProcessingImageSelection,
  ProcessingImagesReview,
}
export type ProcessingImageCropDto = Static<typeof ProcessingImageCrop>
export type ProcessingImagesProposalDto = Static<typeof ProcessingImagesProposal>
export type ProcessingImageSelectionItemDto = Static<typeof ProcessingImageSelectionItem>
export type ProcessingImageSelectionDto = Static<typeof ProcessingImageSelection>
export type ProcessingImagesReviewDto = Static<typeof ProcessingImagesReview>
