import { unicodeText } from './unicode-text.ts'
import { Value } from '@sinclair/typebox/value'
import { Type, type Static, type TProperties } from '@sinclair/typebox'
import { Digest, Id, Revision } from './scalars.ts'

export const MEDIA_SOURCE_MAX_BYTES = 20 * 1024 * 1024
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
/** A removed item: kept with its history, shown only by its label and thumbnail until restored. */
export const MediaRemovedEvidence = object({
  id: Id,
  label,
  /** The first page of its original, served only at the `thumb` size; null before it is decoded. */
  preview_id: nullableId,
  removed_revision: Revision,
  removed_at: Type.String(),
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
export type MediaSnapshotDto = Static<typeof MediaSnapshot>
export type MediaReceiptDto = Static<typeof MediaReceipt>
export type MediaEditDto = Static<typeof MediaEdit>
export const mediaSchemas = { MediaRecipe, MediaVersion, MediaSnapshot, MediaReceipt, MediaEdit }

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
  rotatedMediaRegion,
  requireMediaRecipeBounds,
} from './media-geometry.ts'

const MediaDecoderInputHeader = Type.Union([
  object({
    version: Type.Literal('media-decode/1'),
    digest: Digest,
    recipe: Type.Union([MediaRecipe, Type.Null()]),
  }),
  /** One retained page PNG, rendered into its renditions only. */
  object({
    version: Type.Literal('media-renditions/1'),
    digest: Digest,
    width: dimension,
    height: dimension,
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
