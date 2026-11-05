import { unicodeText } from './unicode-text.ts'
import { Value } from '@sinclair/typebox/value'
import { Type, type Static, type TProperties } from '@sinclair/typebox'
import { Digest, Id, Revision } from './scalars.ts'

export const MEDIA_SOURCE_MAX_BYTES = 20 * 1024 * 1024
/** A decoded page is a lossless PNG, so a 50 MP photo's preview can exceed its upload. */
export const MEDIA_PREVIEW_MAX_BYTES = 64 * 1024 * 1024

const object = <T extends TProperties>(properties: T) =>
  Type.Object(properties, { additionalProperties: false })

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
export const MediaEvidence = object({
  id: Id,
  label,
  group_id: nullableId,
  linked_subject_ids: Type.Array(Id, { maxItems: 200, uniqueItems: true }),
  note: Type.Optional(MediaHumanNote),
  versions: Type.Array(MediaVersion, { maxItems: 100 }),
})
export const MediaSnapshot = object({
  batch_id: Id,
  revision: Revision,
  evidence: Type.Array(MediaEvidence, { maxItems: 200 }),
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

export const MEDIA_TOOLCHAIN = 'sharp/0.35.5;pdfjs/6.4.299;canvas/1.1.0;png/1'

const MediaOutputPage = object({
  page: Type.Integer({ minimum: 1, maximum: 30 }),
  width: dimension,
  height: dimension,
  byte_size: Type.Integer({ minimum: 1, maximum: MEDIA_PREVIEW_MAX_BYTES }),
  digest: Digest,
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

export type MediaOutputPageDto = Static<typeof MediaOutputPage>
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

const MediaDecoderInputHeader = object({
  version: Type.Literal('media-decode/1'),
  digest: Digest,
  recipe: Type.Union([MediaRecipe, Type.Null()]),
})
type MediaDecoderInputHeaderDto = Static<typeof MediaDecoderInputHeader>

export function assertMediaDecoderInputHeader(
  value: unknown,
): asserts value is MediaDecoderInputHeaderDto {
  if (!Value.Check(MediaDecoderInputHeader, value)) {
    throw new Error('invalid_decoder_input')
  }
}
