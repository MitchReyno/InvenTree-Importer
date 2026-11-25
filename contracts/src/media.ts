import { unicodeText } from './unicode-text.ts'
import { Value } from '@sinclair/typebox/value'
import { Type, type Static, type TProperties } from '@sinclair/typebox'
import { Digest, Id, Revision } from './scalars.ts'

export const MEDIA_SOURCE_MAX_BYTES = 20 * 1024 * 1024
const MEDIA_LABEL_MAX_CODE_POINTS = 256

/** An original upload holds 1 byte up to MEDIA_SOURCE_MAX_BYTES. */
export function isMediaSourceSize(bytes: number) {
  return Number.isInteger(bytes) && bytes > 0 && bytes <= MEDIA_SOURCE_MAX_BYTES
}

function isControlCharacter(character: string) {
  const code = character.codePointAt(0) ?? 0
  return code <= 0x1f || code === 0x7f
}

/** Iterating a string yields a lone surrogate as its own character; URI encoding throws on it. */
function isLoneSurrogate(character: string) {
  const code = character.codePointAt(0) ?? 0
  return code >= 0xd800 && code <= 0xdfff
}

/**
 * An original's label: well-formed UTF-16, not blank, at most 256 code points and no control
 * characters. The upload header carries it URI-encoded.
 */
export function isMediaLabel(label: unknown): label is string {
  if (typeof label !== 'string' || !label.trim()) {
    return false
  }
  const characters = [...label]
  if (characters.length > MEDIA_LABEL_MAX_CODE_POINTS) {
    return false
  }
  return !characters.some(
    (character) => isControlCharacter(character) || isLoneSurrogate(character),
  )
}

/** A decoded page is a lossless PNG, so a 50 MP photo's preview can exceed its upload. */
export const MEDIA_PREVIEW_MAX_BYTES = 64 * 1024 * 1024

const object = <T extends TProperties>(properties: T) =>
  Type.Object(properties, { additionalProperties: false })

/** Long-edge bounds of the display renditions; the full-resolution page is never one of them. */
export const MEDIA_RENDITION_SIZES = Object.freeze({ thumb: 320, card: 960, view: 2048 })
export type MediaRenditionSize = keyof typeof MEDIA_RENDITION_SIZES
export const MEDIA_RENDITION_SIZE_NAMES = Object.freeze(
  Object.keys(MEDIA_RENDITION_SIZES) as MediaRenditionSize[],
)
/** 30 pages with three renditions each need about 16.5 KB of result header. */
export const MEDIA_DECODER_HEADER_MAX_BYTES = 64 * 1024

/**
 * The one sizing rule shared by the decoder, the crop route and the frontend. Null means the
 * source is no larger than the size, so that size does not exist and the source serves it.
 */
export function renditionDimensions(
  width: number,
  height: number,
  size: MediaRenditionSize,
): { width: number; height: number } | null {
  const bound = MEDIA_RENDITION_SIZES[size]
  const long = Math.max(width, height)
  if (long <= bound) {
    return null
  }
  const short = Math.max(1, Math.round((Math.min(width, height) * bound) / long))
  return width >= height ? { width: bound, height: short } : { width: short, height: bound }
}

/**
 * The revision in an observation crop URL. It changes whenever the cropped pixels would, so an
 * edited region gets a new URL even though the observation ID is unchanged.
 */
export function observationCropRevision(
  versionId: string,
  page: number,
  region: { x: number; y: number; width: number; height: number },
) {
  return `${versionId}-${page}-${region.x}-${region.y}-${region.width}-${region.height}`
}

/** The sizes a source of these dimensions has, smallest first. */
export function expectedRenditionSizes(width: number, height: number): MediaRenditionSize[] {
  return MEDIA_RENDITION_SIZE_NAMES.filter((size) => renditionDimensions(width, height, size))
}

const nullableId = Type.Union([Id, Type.Null()])
const pixel = Type.Integer({ minimum: 0, maximum: 24000000 })
const dimension = Type.Integer({ minimum: 1, maximum: 24000000 })
const label = unicodeText(1, 256)

/** Coordinates address the orientation-normalized source, before output rotation. */
export const LegacyMediaRecipe = object({
  version: Type.Literal('documentary-crop/1'),
  source_version_id: Id,
  source_digest: Digest,
  page: Type.Integer({ minimum: 1, maximum: 30 }),
  source_width: dimension,
  source_height: dimension,
  x: pixel,
  y: pixel,
  width: dimension,
  height: dimension,
  quarter_turns: Type.Integer({ minimum: 0, maximum: 3 }),
})
const microPixel = Type.String({ pattern: '^(0|[1-9][0-9]{0,13})(?![\\s\\S])' })
export const RotatedMediaRecipe = object({
  version: Type.Literal('documentary-rotated-region/1'),
  source_version_id: Id,
  source_digest: Digest,
  page: Type.Integer({ minimum: 1, maximum: 30 }),
  source_width: dimension,
  source_height: dimension,
  center_x_micro: microPixel,
  center_y_micro: microPixel,
  width_micro: microPixel,
  height_micro: microPixel,
  rotation_millidegrees: Type.Integer({ minimum: 0, maximum: 359999 }),
  output_width: dimension,
  output_height: dimension,
  aspect_ratio: Type.Union([
    object({
      width: Type.Integer({ minimum: 1, maximum: 10000 }),
      height: Type.Integer({ minimum: 1, maximum: 10000 }),
    }),
    Type.Null(),
  ]),
})
export const MediaRecipe = Type.Union([LegacyMediaRecipe, RotatedMediaRecipe])
export type RotatedMediaRecipeDto = Static<typeof RotatedMediaRecipe>

/** Straightening turns a view at most this far either way, in millidegrees. */
export const VIEW_MAX_STRAIGHTEN_MILLIDEGREES = 15_000
/** A rendered view's long edge stays within this; a small region is enlarged towards the minimum. */
export const VIEW_MAX_LONG_EDGE = 2048
export const VIEW_MIN_LONG_EDGE = 1024
/** A small region is enlarged at most this many times. */
export const VIEW_MAX_ZOOM = 4
export const VIEW_THUMB_LONG_EDGE = 480
export const VIEW_MAX_MARKS = 8
export const VIEW_MARK_LABEL_MAX_CHARACTERS = 40

/**
 * What a picture shows of one page: a region in the page preview's pixels, turned by quarter turns
 * and straightened by a small angle. Positive angles turn the picture's content clockwise.
 */
export const MediaViewGeometry = object({
  region: object({ x: pixel, y: pixel, width: dimension, height: dimension }),
  quarter_turns: Type.Integer({ minimum: 0, maximum: 3 }),
  straighten_millidegrees: Type.Integer({
    minimum: -VIEW_MAX_STRAIGHTEN_MILLIDEGREES,
    maximum: VIEW_MAX_STRAIGHTEN_MILLIDEGREES,
  }),
})
/**
 * The shared view recipe: one page of one evidence version, its preview's size and the view.
 * The original is never changed; the decoder renders the view from the page preview.
 */
export const MediaViewRecipe = object({
  version: Type.Literal('bench-intake-view/1'),
  source_version_id: Id,
  source_digest: Digest,
  page: Type.Integer({ minimum: 1, maximum: 30 }),
  page_width: dimension,
  page_height: dimension,
  view: MediaViewGeometry,
})
/** Mark positions are whole ten-thousandths of the rendered view, so sealed recipes hold integers. */
export const VIEW_MARK_UNITS = 10_000
const fraction = Type.Integer({ minimum: 0, maximum: VIEW_MARK_UNITS })
const markPoint = object({ x: fraction, y: fraction })
const markLabel = Type.String({ minLength: 1, maxLength: VIEW_MARK_LABEL_MAX_CHARACTERS })
/**
 * A mark the agent draws over a view, in ten-thousandths of the rendered view's width and height. A
 * circle is drawn round in the middle of its box; a box must lie within the view.
 */
export const MediaViewMark = Type.Union([
  object({
    kind: Type.Union(
      (['circle', 'ellipse', 'box', 'highlight'] as const).map((kind) => Type.Literal(kind)),
    ),
    geometry: object({ x: fraction, y: fraction, width: fraction, height: fraction }),
    label: Type.Optional(markLabel),
  }),
  object({
    kind: Type.Literal('arrow'),
    geometry: object({ from: markPoint, to: markPoint }),
    label: Type.Optional(markLabel),
  }),
  object({ kind: Type.Literal('label'), at: markPoint, label: markLabel }),
])
export const MediaViewMarks = Type.Array(MediaViewMark, { maxItems: VIEW_MAX_MARKS })
export type MediaViewGeometryDto = Static<typeof MediaViewGeometry>

/** Interpreted checks for retained recipes and marks, as the decoder and render queue read them. */
export function assertMediaViewRecipe(value: unknown): asserts value is MediaViewRecipeDto {
  if (!Value.Check(MediaViewRecipe, value)) {
    throw new Error('invalid_view_recipe')
  }
}

export function assertMediaViewMarks(value: unknown): asserts value is MediaViewMarkDto[] {
  if (!Value.Check(MediaViewMarks, value)) {
    throw new Error('invalid_view_marks')
  }
}

export type MediaViewRecipeDto = Static<typeof MediaViewRecipe>
export type MediaViewMarkDto = Static<typeof MediaViewMark>

/** Autocontrast clips at most 5% of the luminance histogram at each end, in tenths of a percent. */
export const VIEW_CONTRAST_MAX_CLIP_PERMILLE = 50
/** Gamma lifts (above 1000) or darkens (below 1000) the midtones, in thousandths. */
export const VIEW_GAMMA_MIN_THOUSANDTHS = 500
export const VIEW_GAMMA_MAX_THOUSANDTHS = 2000

/** A preview renders at most this many crops, from at most this many pages. */
export const PREVIEW_MAX_CROPS = 8
export const PREVIEW_MAX_PAGES = 4
/** A crop's, box's or grid's label is short; it is drawn on the montage or the grid. */
export const DECODER_LABEL_MAX_CHARACTERS = 40
export const GRID_MIN_PREVIEW_WIDTH = 200
export const GRID_MAX_PREVIEW_WIDTH = 2000
export const GRID_MAX_BOXES = 8
export const LOGO_MATCH_MAX_CANDIDATES = 30

/**
 * Light adjustments on a lit view, applied after the geometry in this order. White balance scales
 * each channel by a bounded grey-world gain; the others scale a pixel's channels together to a new
 * luminance. A saturated pixel (HSV saturation of at least ½, channels at least 48 levels apart)
 * turns at most 5° in all. The luminance steps turn a pixel whose brightest channel and channel
 * spread are both at least 16 levels at most 2.5°; below that, rounding can turn or erase a hue.
 */
export const MediaViewLight = object({
  white_balance: Type.Boolean(),
  contrast_clip_permille: Type.Union([
    Type.Integer({ minimum: 0, maximum: VIEW_CONTRAST_MAX_CLIP_PERMILLE }),
    Type.Null(),
  ]),
  gamma_thousandths: Type.Union([
    Type.Integer({ minimum: VIEW_GAMMA_MIN_THOUSANDTHS, maximum: VIEW_GAMMA_MAX_THOUSANDTHS }),
    Type.Null(),
  ]),
  sharpen: Type.Boolean(),
})
/**
 * Recipe `/2`: the shared view recipe with light adjustments. It never carries marks. A derived
 * crop renders it at the region's full resolution.
 */
export const MediaLitViewRecipe = object({
  version: Type.Literal('bench-intake-view/2'),
  source_version_id: Id,
  source_digest: Digest,
  page: Type.Integer({ minimum: 1, maximum: 30 }),
  page_width: dimension,
  page_height: dimension,
  view: MediaViewGeometry,
  light: MediaViewLight,
})
export type MediaViewLightDto = Static<typeof MediaViewLight>
export type MediaLitViewRecipeDto = Static<typeof MediaLitViewRecipe>

export function assertMediaLitViewRecipe(value: unknown): asserts value is MediaLitViewRecipeDto {
  if (!Value.Check(MediaLitViewRecipe, value)) {
    throw new Error('invalid_view_recipe')
  }
}

export const MediaDecodeState = Type.Union(
  ['queued', 'ready', 'unsupported', 'encrypted', 'malformed', 'limit_exceeded', 'interrupted'].map(
    (state) => Type.Literal(state),
  ),
)
export const MediaVersion = object({
  id: Id,
  evidence_id: Id,
  kind: Type.Union([Type.Literal('original'), Type.Literal('derived')]),
  digest: Digest,
  byte_size: Type.String({ pattern: '^[1-9][0-9]{0,8}(?![\\s\\S])' }),
  media_type: Type.Union([
    Type.Literal('image/jpeg'),
    Type.Literal('image/png'),
    Type.Literal('application/pdf'),
    Type.Literal('application/octet-stream'),
  ]),
  state: MediaDecodeState,
  decoder_build: Type.Union([Type.String({ minLength: 1, maxLength: 256 }), Type.Null()]),
  recipe: Type.Union([MediaRecipe, Type.Null()]),
  pages: Type.Array(
    object({
      page: Type.Integer({ minimum: 1, maximum: 30 }),
      width: dimension,
      height: dimension,
      preview_id: Id,
    }),
    { maxItems: 30 },
  ),
})
export const MediaHumanNote = object({
  id: Id,
  version: Revision,
  text: unicodeText(0, 8192),
  actor_id: Id,
  created_at: Type.String(),
})
const evidenceLotIds = Type.Array(Id, { minItems: 1, maxItems: 200, uniqueItems: true })
export const MediaEvidence = object({
  id: Id,
  label,
  group_id: nullableId,
  linked_subject_ids: Type.Array(Id, { maxItems: 200, uniqueItems: true }),
  note: Type.Optional(MediaHumanNote),
  versions: Type.Array(MediaVersion, { maxItems: 100 }),
  /** The approval that used it, so it can't be removed. Omitted while no approval used it. */
  pinned_by: Type.Optional(object({ approval_id: Id, approved_at: Type.String() })),
  /** Lots it feeds through observations or subject links. Omitted when none. */
  lot_ids: Type.Optional(evidenceLotIds),
  /** Lots that would be left with no supporting evidence if it were removed. Omitted when none. */
  sole_evidence_lot_ids: Type.Optional(evidenceLotIds),
  /** Attachment selections of one of its versions that removing it clears. Omitted when none. */
  selected_attachment_of: Type.Optional(
    Type.Array(
      object({
        subject_id: Id,
        destination: Type.Union([Type.Literal('lot_attachment'), Type.Literal('part_attachment')]),
      }),
      { minItems: 1, maxItems: 200 },
    ),
  ),
})
const removalSelections = Type.Array(
  object({
    subject_id: Id,
    destination: Type.Union([Type.Literal('lot_attachment'), Type.Literal('part_attachment')]),
  }),
  { maxItems: 200 },
)
/** What removing several present items together would change, for a bulk delete. */
export const MediaRemovalImpact = object({
  evidence_ids: Type.Array(Id, { minItems: 1, maxItems: 200, uniqueItems: true }),
  lot_ids: Type.Array(Id, { maxItems: 200, uniqueItems: true }),
  /** Lots left with no supporting evidence once all of them are removed. */
  sole_evidence_lot_ids: Type.Array(Id, { maxItems: 200, uniqueItems: true }),
  selected_attachment_of: removalSelections,
})
/** A removed item: kept with its history, shown only by its label and thumbnail until restored. */
export const MediaRemovedEvidence = object({
  id: Id,
  label,
  /** The first page of its original, served only at the `thumb` size; null before it is decoded. */
  preview_id: nullableId,
  removed_revision: Revision,
  removed_at: Type.String(),
  /**
   * Its place among all the batch's files, present and removed, in upload order. Present files
   * fill the other places in snapshot order, so names numbered over both stay stable. Upload
   * capacity counts removed items, so a batch never holds more than 200 files in all.
   */
  position: Type.Integer({ minimum: 0, maximum: 199 }),
})
export const MediaSnapshot = object({
  batch_id: Id,
  revision: Revision,
  evidence: Type.Array(MediaEvidence, { maxItems: 200 }),
  /** Removed items still count towards the 200-item capacity. Omitted when none. */
  removed: Type.Optional(Type.Array(MediaRemovedEvidence, { minItems: 1, maxItems: 200 })),
  attachments: Type.Array(
    object({
      id: Id,
      subject_id: Id,
      mode: Type.Union([Type.Literal('selected'), Type.Literal('declined'), Type.Literal('unset')]),
      version_id: nullableId,
      destination: Type.Union([Type.Literal('lot_attachment'), Type.Literal('part_attachment')]),
    }),
    { maxItems: 200 },
  ),
  groups: Type.Array(object({ id: Id, label, note: Type.Optional(MediaHumanNote) }), {
    maxItems: 100,
  }),
  derivations: Type.Array(
    object({
      id: Id,
      evidence_id: Id,
      recipe: MediaRecipe,
      state: MediaDecodeState,
      version_id: nullableId,
    }),
    { maxItems: 200 },
  ),
})
/** Receipt means durable original bytes plus committed ownership; it does not mean readable. */
export const MediaReceipt = object({
  status: Type.Literal('retained'),
  batch_id: Id,
  evidence_id: Id,
  version: MediaVersion,
})
const evidenceIds = Type.Array(Id, { minItems: 1, maxItems: 200, uniqueItems: true })
export const MediaEdit = object({
  expected_revision: Revision,
  change: Type.Union([
    object({ kind: Type.Literal('group'), label }),
    object({ kind: Type.Literal('rename_group'), group_id: Id, label }),
    object({ kind: Type.Literal('ungroup'), group_id: Id }),
    object({
      kind: Type.Literal('move_many'),
      evidence_ids: Type.Array(Id, { minItems: 1, maxItems: 200, uniqueItems: true }),
      group_id: nullableId,
    }),
    object({
      kind: Type.Literal('evidence_note'),
      evidence_id: Id,
      text: Type.String({ maxLength: 8192 }),
    }),
    object({ kind: Type.Literal('move'), evidence_id: Id, group_id: nullableId }),
    /** Removes photos or documents from the batch; bytes and history are kept. */
    object({ kind: Type.Literal('remove'), evidence_ids: evidenceIds }),
    /** Brings removed items back, into their group while it is still active. */
    object({ kind: Type.Literal('restore'), evidence_ids: evidenceIds }),
    object({ kind: Type.Literal('link'), evidence_id: Id, subject_id: Id, linked: Type.Boolean() }),
    object({
      kind: Type.Literal('derive'),
      evidence_id: Id,
      derivation_id: Type.Optional(Id),
      recipe: MediaRecipe,
    }),
    object({
      kind: Type.Literal('select_attachment'),
      subject_id: Id,
      mode: Type.Union([Type.Literal('selected'), Type.Literal('declined'), Type.Literal('unset')]),
      version_id: nullableId,
      destination: Type.Union([Type.Literal('lot_attachment'), Type.Literal('part_attachment')]),
    }),
  ]),
})

export type MediaRecipeDto = Static<typeof MediaRecipe>
export type MediaVersionDto = Static<typeof MediaVersion>
export type MediaEvidenceDto = Static<typeof MediaEvidence>
export type MediaRemovedEvidenceDto = Static<typeof MediaRemovedEvidence>
export type MediaRemovalImpactDto = Static<typeof MediaRemovalImpact>
export type MediaSnapshotDto = Static<typeof MediaSnapshot>
export type MediaReceiptDto = Static<typeof MediaReceipt>
export type MediaEditDto = Static<typeof MediaEdit>
export const mediaSchemas = {
  MediaRecipe,
  MediaViewRecipe,
  MediaVersion,
  MediaSnapshot,
  MediaReceipt,
  MediaEdit,
  MediaRemovalImpact,
}

/** Interpreted validation for the isolated decoder, where dynamic code generation is disabled. */
export function assertMediaRecipe(value: unknown): asserts value is MediaRecipeDto {
  if (!Value.Check(MediaRecipe, value)) {
    throw new Error('invalid_media_recipe')
  }
}

export const MEDIA_TOOLCHAIN = 'sharp/0.35.5;pdfjs/6.4.299;canvas/1.1.0;png/1;webp/1'

const MediaOutputRendition = object({
  size: Type.Union(MEDIA_RENDITION_SIZE_NAMES.map((size) => Type.Literal(size))),
  width: dimension,
  height: dimension,
  byte_size: Type.Integer({ minimum: 1, maximum: MEDIA_PREVIEW_MAX_BYTES }),
  digest: Digest,
})

const MediaOutputPage = object({
  page: Type.Integer({ minimum: 1, maximum: 30 }),
  width: dimension,
  height: dimension,
  byte_size: Type.Integer({ minimum: 1, maximum: MEDIA_PREVIEW_MAX_BYTES }),
  digest: Digest,
  renditions: Type.Array(MediaOutputRendition, { maxItems: MEDIA_RENDITION_SIZE_NAMES.length }),
})

const MediaOutputHeader = Type.Union([
  object({
    state: Type.Literal('ready'),
    toolchain: Type.Literal(MEDIA_TOOLCHAIN),
    pages: Type.Array(MediaOutputPage, { minItems: 1, maxItems: 30 }),
  }),
  object({
    state: Type.Union([
      Type.Literal('unsupported'),
      Type.Literal('encrypted'),
      Type.Literal('malformed'),
      Type.Literal('limit_exceeded'),
    ]),
    toolchain: Type.Literal(MEDIA_TOOLCHAIN),
    pages: Type.Array(MediaOutputPage, { maxItems: 0 }),
  }),
])

/** A renditions-only result; `malformed` means the bytes are not the recorded PNG. */
const MediaRenditionOutputHeader = Type.Union([
  object({
    state: Type.Literal('ready'),
    toolchain: Type.Literal(MEDIA_TOOLCHAIN),
    renditions: Type.Array(MediaOutputRendition, { maxItems: MEDIA_RENDITION_SIZE_NAMES.length }),
  }),
  object({
    state: Type.Literal('malformed'),
    toolchain: Type.Literal(MEDIA_TOOLCHAIN),
    renditions: Type.Array(MediaOutputRendition, { maxItems: 0 }),
  }),
])
export type MediaRenditionOutputHeaderDto = Static<typeof MediaRenditionOutputHeader>

export function assertMediaRenditionOutputHeader(
  value: unknown,
): asserts value is MediaRenditionOutputHeaderDto {
  if (!Value.Check(MediaRenditionOutputHeader, value)) {
    throw new Error('invalid_decoder_output')
  }
}

const MediaViewOutputImage = object({
  width: dimension,
  height: dimension,
  byte_size: Type.Integer({ minimum: 1, maximum: MEDIA_PREVIEW_MAX_BYTES }),
  digest: Digest,
})
/**
 * A rendered view: the operator's WebP view and thumbnail, and, when marks were sent, a PNG preview
 * with them drawn in for the agent. `malformed` means the page bytes or the recipe don't fit.
 */
const MediaViewOutputHeader = Type.Union([
  object({
    state: Type.Literal('ready'),
    toolchain: Type.Literal(MEDIA_TOOLCHAIN),
    view: MediaViewOutputImage,
    thumb: MediaViewOutputImage,
    preview: Type.Union([MediaViewOutputImage, Type.Null()]),
  }),
  object({ state: Type.Literal('malformed'), toolchain: Type.Literal(MEDIA_TOOLCHAIN) }),
])
export type MediaViewOutputHeaderDto = Static<typeof MediaViewOutputHeader>

export function assertMediaViewOutputHeader(
  value: unknown,
): asserts value is MediaViewOutputHeaderDto {
  if (!Value.Check(MediaViewOutputHeader, value)) {
    throw new Error('invalid_decoder_output')
  }
}

const failedDecoderOperation = object({
  state: Type.Union([Type.Literal('malformed'), Type.Literal('limit_exceeded')]),
  toolchain: Type.Literal(MEDIA_TOOLCHAIN),
})
const outputLabel = Type.String({ minLength: 1, maxLength: DECODER_LABEL_MAX_CHARACTERS })
const outputRegion = object({ x: pixel, y: pixel, width: dimension, height: dimension })

/**
 * One previewed crop: its size and what the renderer changed, or why it refused the recipe. A
 * `corner_guard` crop was shrunk so straightening shows no blank corners; `white_balance_held_back`
 * means the gains were scaled towards 1 to keep saturated hues.
 */
const PreviewCropOutput = Type.Union([
  object({
    state: Type.Literal('rendered'),
    label: outputLabel,
    width: dimension,
    height: dimension,
    flags: Type.Array(
      Type.Union([Type.Literal('corner_guard'), Type.Literal('white_balance_held_back')]),
      { maxItems: 2, uniqueItems: true },
    ),
    white_balance_gains: Type.Union([
      object({ red: Type.Number(), green: Type.Number(), blue: Type.Number() }),
      Type.Null(),
    ]),
  }),
  object({
    state: Type.Literal('refused'),
    label: outputLabel,
    reason: Type.Literal('white_balance_hue_guard'),
  }),
])
/** The montage PNG follows the header. */
const MediaPreviewOutputHeader = Type.Union([
  object({
    state: Type.Literal('ready'),
    toolchain: Type.Literal(MEDIA_TOOLCHAIN),
    montage: MediaViewOutputImage,
    crops: Type.Array(PreviewCropOutput, { minItems: 1, maxItems: PREVIEW_MAX_CROPS }),
  }),
  failedDecoderOperation,
])
export type MediaPreviewOutputHeaderDto = Static<typeof MediaPreviewOutputHeader>

export function assertMediaPreviewOutputHeader(
  value: unknown,
): asserts value is MediaPreviewOutputHeaderDto {
  if (!Value.Check(MediaPreviewOutputHeader, value)) {
    throw new Error('invalid_decoder_output')
  }
}

/**
 * A grid overlay: its scale (preview pixels per page pixel), the grid step and the labelled lines,
 * all in page pixels, and each box's size, aspect and margins to the object when one was given.
 * The grid PNG follows the header.
 */
const MediaGridOutputHeader = Type.Union([
  object({
    state: Type.Literal('ready'),
    toolchain: Type.Literal(MEDIA_TOOLCHAIN),
    image: MediaViewOutputImage,
    region: outputRegion,
    scale: Type.Number({ exclusiveMinimum: 0 }),
    step: Type.Integer({ minimum: 1 }),
    x_labels: Type.Array(pixel, { maxItems: 400 }),
    y_labels: Type.Array(pixel, { maxItems: 400 }),
    boxes: Type.Array(
      object({
        name: outputLabel,
        /** The name, or the box's number when the name didn't fit; null when neither was drawn. */
        drawn_label: Type.Union([outputLabel, Type.Null()]),
        box: outputRegion,
        aspect: Type.Number({ exclusiveMinimum: 0 }),
        margins: Type.Union([
          object({
            left: Type.Integer(),
            right: Type.Integer(),
            top: Type.Integer(),
            bottom: Type.Integer(),
          }),
          Type.Null(),
        ]),
        clips: Type.Boolean(),
        off_centre: Type.Array(Type.Union([Type.Literal('x'), Type.Literal('y')]), {
          maxItems: 2,
          uniqueItems: true,
        }),
      }),
      { maxItems: GRID_MAX_BOXES },
    ),
  }),
  failedDecoderOperation,
])
export type MediaGridOutputHeaderDto = Static<typeof MediaGridOutputHeader>

export function assertMediaGridOutputHeader(
  value: unknown,
): asserts value is MediaGridOutputHeaderDto {
  if (!Value.Check(MediaGridOutputHeader, value)) {
    throw new Error('invalid_decoder_output')
  }
}

/**
 * The logo set ranked against a view, best first. A view with no mark to compare has no
 * candidates. The candidate sheet PNG follows the header.
 */
const MediaLogoMatchOutputHeader = Type.Union([
  object({
    state: Type.Literal('ready'),
    toolchain: Type.Literal(MEDIA_TOOLCHAIN),
    sheet: MediaViewOutputImage,
    candidates: Type.Array(
      object({
        id: Type.String({ minLength: 1, maxLength: 64 }),
        manufacturer: Type.String({ minLength: 1, maxLength: 200 }),
        family: Type.String({ minLength: 1, maxLength: 32 }),
        page: Type.String({ minLength: 1, maxLength: 64 }),
        score: Type.Number({ minimum: -1, maximum: 1 }),
      }),
      { maxItems: LOGO_MATCH_MAX_CANDIDATES },
    ),
  }),
  failedDecoderOperation,
])
export type MediaLogoMatchOutputHeaderDto = Static<typeof MediaLogoMatchOutputHeader>

export function assertMediaLogoMatchOutputHeader(
  value: unknown,
): asserts value is MediaLogoMatchOutputHeaderDto {
  if (!Value.Check(MediaLogoMatchOutputHeader, value)) {
    throw new Error('invalid_decoder_output')
  }
}

export type MediaOutputPageDto = Static<typeof MediaOutputPage>
export type MediaOutputRenditionDto = Static<typeof MediaOutputRendition>
export type MediaOutputHeaderDto = Static<typeof MediaOutputHeader>

/** Decoder structural schema stays interpreted under the no-code-generation policy. */
export function assertMediaOutputHeader(value: unknown): asserts value is MediaOutputHeaderDto {
  if (!Value.Check(MediaOutputHeader, value)) {
    throw new Error('invalid_decoder_output')
  }
}

export const MEDIA_INPUT_MAX_SUBJECTS = 100
export const MEDIA_INPUT_MAX_VERSIONS = 64
export const MEDIA_INPUT_MAX_BYTES = 256 * 1024

const MediaInputVersion = object({
  versionId: Id,
  evidenceId: Id,
  kind: Type.Union([Type.Literal('original'), Type.Literal('derived')]),
  digest: Digest,
  byteSize: Type.String({ pattern: '^[1-9][0-9]{0,7}$' }),
  mediaType: MediaVersion.properties.media_type,
  recipe: Type.Union([MediaRecipe, Type.Null()]),
})
const mediaInputFields = {
  batchId: Id,
  subjectIds: Type.Array(Id, { maxItems: MEDIA_INPUT_MAX_SUBJECTS, uniqueItems: true }),
  attachments: MediaSnapshot.properties.attachments,
  evidence: Type.Array(
    object({
      evidenceId: Id,
      groupId: nullableId,
      linkedSubjectIds: Type.Array(Id, { maxItems: 100, uniqueItems: true }),
    }),
    { maxItems: 200 },
  ),
  versions: Type.Array(MediaInputVersion, { maxItems: MEDIA_INPUT_MAX_VERSIONS }),
}
const MediaInputManifestV1 = object({
  ...mediaInputFields,
  version: Type.Literal('media-inputs/1'),
  attachments: Type.Array(
    object({
      ...MediaSnapshot.properties.attachments.items.properties,
      destination: Type.Literal('lot_attachment'),
    }),
    { maxItems: 200 },
  ),
})
const MediaInputManifestV2 = object({
  ...mediaInputFields,
  version: Type.Literal('media-inputs/2'),
})
export const MediaInputContext = object({
  groups: Type.Array(MediaSnapshot.properties.groups.items, { maxItems: 100 }),
  evidenceNotes: Type.Array(object({ evidenceId: Id, note: MediaHumanNote }), { maxItems: 200 }),
})
const MediaInputManifestV3 = object({
  ...mediaInputFields,
  version: Type.Literal('media-inputs/3'),
  context: MediaInputContext,
})
export const MediaInputManifest = Type.Union([
  MediaInputManifestV1,
  MediaInputManifestV2,
  MediaInputManifestV3,
])
export type MediaInputContextDto = Static<typeof MediaInputContext>
export type MediaInputManifestDto = Static<typeof MediaInputManifest>

export function assertMediaInputManifest(value: unknown): asserts value is MediaInputManifestDto {
  if (!Value.Check(MediaInputManifest, value)) {
    throw new Error('invalid_media_input_manifest')
  }
}

const attachmentPk = Type.String({ pattern: '^[1-9][0-9]{0,18}(?![\\s\\S])' })
const attachmentMetadata = {
  capability: Type.Literal('owned-fake-media/1'),
  artifact: Id,
  stock: attachmentPk,
  sha256: Digest,
  byte_size: Type.String({ pattern: '^[1-9][0-9]{0,7}$' }),
  media_type: Type.Union([
    Type.Literal('image/jpeg'),
    Type.Literal('image/png'),
    Type.Literal('application/pdf'),
  ]),
}
const AttachmentReceipt = Type.Union([
  object({ ...attachmentMetadata, pk: attachmentPk }),
  object({
    ...attachmentMetadata,
    effect: Type.Literal('none'),
    reason: Type.String({ minLength: 1, maxLength: 64 }),
  }),
])
export type AttachmentReceiptDto = Static<typeof AttachmentReceipt>

export function assertAttachmentReceipt(value: unknown): asserts value is AttachmentReceiptDto {
  if (!Value.Check(AttachmentReceipt, value)) {
    throw new Error('invalid_attachment_receipt')
  }
}

export {
  MEDIA_MICRO_PIXELS,
  regionTrigonometry,
  viewLayout,
  type ViewLayout,
  type ViewSize,
  rotatedMediaRegion,
  requireMediaRecipeBounds,
} from './media-geometry.ts'

const decoderLabel = Type.String({ minLength: 1, maxLength: DECODER_LABEL_MAX_CHARACTERS })
const pageRegion = object({ x: pixel, y: pixel, width: dimension, height: dimension })
/** A page preview PNG and the evidence page it was decoded from, which each recipe must name. */
const PreviewPage = object({
  source_version_id: Id,
  source_digest: Digest,
  page: Type.Integer({ minimum: 1, maximum: 30 }),
  digest: Digest,
  width: dimension,
  height: dimension,
  byte_size: Type.Integer({ minimum: 1, maximum: MEDIA_PREVIEW_MAX_BYTES }),
})
const PreviewCrop = object({
  label: decoderLabel,
  /** Index into `pages`. */
  page: Type.Integer({ minimum: 0, maximum: PREVIEW_MAX_PAGES - 1 }),
  recipe: MediaLitViewRecipe,
})

const MediaDecoderInputHeader = Type.Union([
  /** An original decoded into pages; with a recipe, into the one derived crop it describes. */
  object({
    version: Type.Literal('media-decode/1'),
    digest: Digest,
    recipe: Type.Union([MediaRecipe, MediaLitViewRecipe, Type.Null()]),
  }),
  /** One retained page PNG, rendered into its renditions only. */
  object({
    version: Type.Literal('media-renditions/1'),
    digest: Digest,
    width: dimension,
    height: dimension,
  }),
  /** One retained page PNG, rendered into a view of the recipe; marks only for an agent preview. */
  object({
    version: Type.Literal('media-view/1'),
    digest: Digest,
    width: dimension,
    height: dimension,
    recipe: MediaViewRecipe,
    marks: Type.Union([MediaViewMarks, Type.Null()]),
  }),
  /** A view of a lit recipe `/2`, lit at full resolution and then sized; it never has marks. */
  object({
    version: Type.Literal('media-view/1'),
    digest: Digest,
    width: dimension,
    height: dimension,
    recipe: MediaLitViewRecipe,
    marks: Type.Null(),
  }),
  /**
   * `preview_images`: retained page PNGs, sent one after another in this order, and lit recipes on
   * them, each rendered as its derived crop would be, then laid out on one labelled montage.
   */
  object({
    version: Type.Literal('media-preview/1'),
    pages: Type.Array(PreviewPage, { minItems: 1, maxItems: PREVIEW_MAX_PAGES }),
    crops: Type.Array(PreviewCrop, { minItems: 1, maxItems: PREVIEW_MAX_CROPS }),
  }),
  /**
   * `inspect_region`: a labelled grid in page pixels over one retained page PNG, or a region of it,
   * with proposed boxes measured against the object's bounds. A null step picks one.
   */
  object({
    version: Type.Literal('media-grid/1'),
    digest: Digest,
    width: dimension,
    height: dimension,
    region: Type.Union([pageRegion, Type.Null()]),
    preview_width: Type.Integer({
      minimum: GRID_MIN_PREVIEW_WIDTH,
      maximum: GRID_MAX_PREVIEW_WIDTH,
    }),
    step: Type.Union([Type.Integer({ minimum: 1, maximum: 100_000 }), Type.Null()]),
    object: Type.Union([pageRegion, Type.Null()]),
    boxes: Type.Array(object({ name: decoderLabel, box: pageRegion }), {
      maxItems: GRID_MAX_BOXES,
    }),
  }),
  /** `match_logo`: the bundled logo set ranked against a view of one retained page PNG. */
  object({
    version: Type.Literal('media-logo-match/1'),
    digest: Digest,
    width: dimension,
    height: dimension,
    view: MediaViewGeometry,
    top: Type.Integer({ minimum: 1, maximum: LOGO_MATCH_MAX_CANDIDATES }),
  }),
])
type MediaDecoderInputHeaderDto = Static<typeof MediaDecoderInputHeader>

export function assertMediaDecoderInputHeader(
  value: unknown,
): asserts value is MediaDecoderInputHeaderDto {
  if (!Value.Check(MediaDecoderInputHeader, value)) {
    throw new Error('invalid_decoder_input')
  }
}
