import { Type, type Static, type TProperties } from '@sinclair/typebox'
import { Digest, Id, IsoTime, Quantity, Revision } from './scalars.ts'
import { CaptureDefaults, CaptureQuantity, LotExclusion } from './capture.ts'
import { note } from './capture-primitives.ts'
import {
  CaptureEvidenceObservation,
  EvidenceReadings,
  EvidenceRegion,
} from './evidence-observations.ts'
import { SessionProposal } from './processing.ts'

const object = <T extends TProperties>(properties: T) =>
  Type.Object(properties, { additionalProperties: false })

/**
 * A `/7` session's brief: what it is given before it starts, sealed into its input. The shared
 * sections come first, then its stage's. Each section exists from the start; a section whose data
 * a later change supplies (Match state, the vocabulary) is empty until then.
 */
export const BRIEF_SHARED_SECTIONS = ['batch', 'human', 'asked', 'evidence', 'match'] as const
export const BRIEF_STAGE_SECTIONS = {
  examine: ['observations', 'lots', 'parts'],
  research: ['identity', 'observations', 'vocabulary'],
  images: ['observations', 'keep_out'],
} as const

/** The agent stages a brief is built for. */
export const BriefStage = Type.Union([
  Type.Literal('examine'),
  Type.Literal('research'),
  Type.Literal('images'),
])

export const BriefSectionName = Type.Union(
  [
    ...BRIEF_SHARED_SECTIONS,
    ...new Set(Object.values(BRIEF_STAGE_SECTIONS).flatMap((sections) => [...sections])),
  ].map((name) => Type.Literal(name)),
)

/** The fields a question may be about; the same literals as `ProcessingField`. */
const briefField = Type.Union(
  (['markings', 'identity', 'quantity', 'research', 'images'] as const).map((field) =>
    Type.Literal(field),
  ),
)
const human = { source: Type.Literal('human') }
const shortText = Type.String({ minLength: 1, maxLength: 2048 })
const longText = Type.String({ minLength: 1, maxLength: 8192 })

/** The batch, its defaults and its web policy. */
export const BriefBatchEntry = object({
  kind: Type.Literal('batch'),
  batch_id: Id,
  title: Type.String({ minLength: 1, maxLength: 256 }),
  defaults: CaptureDefaults,
  web: object({ public_pages: Type.Boolean(), prefer_datasheets: Type.Boolean() }),
})

/** One saved instruction: the batch's latest, or an evidence group's latest when it names one. */
export const BriefInstructionEntry = object({
  kind: Type.Literal('instruction'),
  instruction_id: Id,
  group_id: Type.Union([Id, Type.Null()]),
  text: note,
})

/**
 * A note the operator wrote, with what it is about: a subject, an evidence item or an evidence
 * group, or (all of them null) the whole batch.
 */
export const BriefNoteEntry = object({
  kind: Type.Literal('note'),
  ...human,
  note_id: Id,
  subject_id: Type.Union([Id, Type.Null()]),
  evidence_id: Type.Union([Id, Type.Null()]),
  group_id: Type.Union([Id, Type.Null()]),
  text: note,
  text_sha256: Digest,
  actor_id: Id,
  created_at: Type.String({ minLength: 1, maxLength: 64 }),
})

/** The operator's answer to a question, with each step's prompt and the value given. */
export const BriefAnswerEntry = object({
  kind: Type.Literal('answer'),
  ...human,
  question_id: Id,
  answer_id: Id,
  subject_id: Type.Union([Id, Type.Null()]),
  actor_id: Id,
  answered_at: IsoTime,
  steps: Type.Array(
    object({
      step_id: Type.Union([Type.String(), Type.Null()]),
      prompt: shortText,
      value: longText,
    }),
    { minItems: 1, maxItems: 4 },
  ),
})

/**
 * The operator corrected an observation's reading. `before` is the reading it replaced, or null
 * when the correction was made before earlier readings were kept (`earlier_known` false).
 */
export const BriefCorrectionEntry = object({
  kind: Type.Literal('correction'),
  ...human,
  observation_id: Id,
  lot_id: Type.Union([Id, Type.Null()]),
  before: Type.Union([EvidenceReadings, Type.Null()]),
  after: EvidenceReadings,
  earlier_known: Type.Boolean(),
  actor_id: Type.Union([Id, Type.Null()]),
  corrected_at: Type.Union([IsoTime, Type.Null()]),
  revision: Type.Union([Revision, Type.Null()]),
})

/** A lot the operator edited, as it stands, with the revision that identifies this edit. */
export const BriefLotEditEntry = object({
  kind: Type.Literal('lot_edit'),
  ...human,
  /** Identifies this state of the lot: `lot:<lot_id>@<lot_revision>`. */
  edit_id: Type.String({ minLength: 1, maxLength: 128 }),
  lot_id: Id,
  lot_revision: Revision,
  label: Type.String({ minLength: 1, maxLength: 256 }),
  quantity: CaptureQuantity,
  part_subject_id: Type.Union([Id, Type.Null()]),
  excluded: Type.Union([LotExclusion, Type.Null()]),
})

/** A question already asked about the subject, its Part or the batch, with its assumptions. */
export const BriefQuestionEntry = object({
  kind: Type.Literal('question'),
  question_id: Id,
  job_id: Id,
  subject_id: Type.Union([Id, Type.Null()]),
  /** Empty for an earlier runner question, which named none. */
  fields: Type.Array(briefField, { maxItems: 5 }),
  state: Type.Union([Type.Literal('open'), Type.Literal('answered'), Type.Literal('superseded')]),
  title: shortText,
  steps: Type.Array(
    object({
      id: Type.String({ minLength: 1, maxLength: 64 }),
      prompt: shortText,
      assumption: Type.Union([shortText, Type.Null()]),
    }),
    { minItems: 1, maxItems: 4 },
  ),
  answer_id: Type.Union([Id, Type.Null()]),
})

/** An evidence version the session may fetch, with the regions earlier stages read in it. */
export const BriefEvidenceEntry = object({
  kind: Type.Literal('evidence'),
  evidence_id: Id,
  version_id: Id,
  sha256: Digest,
  media_type: Type.String({ minLength: 1, maxLength: 128 }),
  label: Type.Union([Type.String({ minLength: 1, maxLength: 256 }), Type.Null()]),
  regions: Type.Array(
    object({
      observation_id: Id,
      page: Type.Integer({ minimum: 1, maximum: 10000 }),
      region: EvidenceRegion,
      lot_id: Type.Union([Id, Type.Null()]),
    }),
    { maxItems: 1000 },
  ),
})

/** One observation with its full readings, source and confidence. */
export const BriefObservationEntry = object({
  kind: Type.Literal('observation'),
  observation: CaptureEvidenceObservation,
})

/** Examine: a lot with its exclusion, why it is flagged to look at again and its estimate. */
export const BriefLotEntry = object({
  kind: Type.Literal('lot'),
  lot_id: Id,
  label: Type.String({ minLength: 1, maxLength: 256 }),
  origin: Type.Union([Type.Literal('agent'), Type.Literal('operator')]),
  operator_edited: Type.Boolean(),
  retired: Type.Boolean(),
  excluded: Type.Union([LotExclusion, Type.Null()]),
  reexamine: Type.Boolean(),
  /** The lot's observations whose readings the operator corrected. */
  corrected_observation_ids: Type.Array(Id, { maxItems: 100 }),
  part_subject_id: Type.Union([Id, Type.Null()]),
  estimated_quantity: Type.Union([Quantity, Type.Null()]),
  quantity_basis: Type.Union([Type.String({ minLength: 1, maxLength: 512 }), Type.Null()]),
  /**
   * Cite as an `observation_set` source; an identity relying on the current one is stable. Null
   * for a lot that has never had an observation.
   */
  observation_set_version: Type.Union([Revision, Type.Null()]),
  observation_ids: Type.Array(Id, { maxItems: 100 }),
  suggested_observation_ids: Type.Array(Id, { maxItems: 1000 }),
})

/** Examine: a Part subject of the batch, which a lot may share. */
export const BriefPartEntry = object({
  kind: Type.Literal('part'),
  part_subject_id: Id,
  label: Type.String({ minLength: 1, maxLength: 256 }),
  revision: Revision,
})

/** Research: an identity the session was pinned to, by its id, with the proposal as published. */
export const BriefIdentityEntry = object({
  kind: Type.Literal('identity'),
  proposal_id: Id,
  stale: Type.Boolean(),
  proposal: SessionProposal,
})

/** Images: another lot's item seen on the same evidence, to keep out of frame. */
export const BriefKeepOutEntry = object({
  kind: Type.Literal('keep_out'),
  observation_id: Id,
  lot_id: Type.Union([Id, Type.Null()]),
  evidence_version_id: Id,
  page: Type.Integer({ minimum: 1, maximum: 10000 }),
  region: EvidenceRegion,
  markings: EvidenceReadings.properties.markings,
})

export const BriefEntry = Type.Union([
  BriefBatchEntry,
  BriefInstructionEntry,
  BriefNoteEntry,
  BriefAnswerEntry,
  BriefCorrectionEntry,
  BriefLotEditEntry,
  BriefQuestionEntry,
  BriefEvidenceEntry,
  BriefObservationEntry,
  BriefLotEntry,
  BriefPartEntry,
  BriefIdentityEntry,
  BriefKeepOutEntry,
])

export const BriefSections = Type.Array(
  object({ name: BriefSectionName, count: Type.Integer({ minimum: 0, maximum: 100000 }) }),
  { minItems: 1, maxItems: 8 },
)

const briefHeader = {
  schema_version: Type.Literal('bench-intake-brief/1'),
  stage: BriefStage,
  lot_id: Type.Union([Id, Type.Null()]),
  /** The capture revision the brief was read at. */
  revision: Revision,
  sections: BriefSections,
}

/** The whole brief: its header and every entry, in section order. */
export const SessionBrief = object({
  ...briefHeader,
  entries: Type.Array(BriefEntry, { maxItems: 100000 }),
})

/** The most pages one brief may have; a brief beyond them is refused as over capacity. */
export const BRIEF_MAX_PAGES = 64

/**
 * The brief as an input seals it: its digest, and each page's digest. Pages that fit in the
 * manifest carry their entries; the rest are in the input's page store.
 */
export const SealedBrief = object({
  ...briefHeader,
  sha256: Digest,
  pages: Type.Array(
    object({
      index: Type.Integer({ minimum: 1, maximum: BRIEF_MAX_PAGES }),
      sha256: Digest,
      entry_count: Type.Integer({ minimum: 0, maximum: 100000 }),
      entries: Type.Optional(Type.Array(BriefEntry, { maxItems: 100000 })),
    }),
    { minItems: 1, maxItems: BRIEF_MAX_PAGES },
  ),
})

/** One stored page of a brief: its entries in order. */
export const BriefPage = object({
  schema_version: Type.Literal('bench-intake-brief-page/1'),
  index: Type.Integer({ minimum: 1, maximum: BRIEF_MAX_PAGES }),
  entries: Type.Array(BriefEntry, { maxItems: 100000 }),
})

/** Continues a page sequence; it names the revision's view and the page to read next. */
export const BriefPageToken = Type.String({
  minLength: 1,
  maxLength: 512,
  pattern: '^[A-Za-z0-9_-]+$',
})

/** What `read_lot` and `read_batch` return for a `/7` session: one page of a brief. */
export const SessionBriefPage = object({
  view: Type.Union([Type.Literal('sealed'), Type.Literal('current')]),
  stage: BriefStage,
  lot_id: Type.Union([Id, Type.Null()]),
  revision: Revision,
  sha256: Digest,
  sections: BriefSections,
  page: Type.Integer({ minimum: 1, maximum: BRIEF_MAX_PAGES }),
  page_count: Type.Integer({ minimum: 1, maximum: BRIEF_MAX_PAGES }),
  entries: Type.Array(BriefEntry, { maxItems: 100000 }),
  next_page_token: Type.Union([BriefPageToken, Type.Null()]),
  /** Set when the current brief differs from the one these pages come from. */
  newer: Type.Union([object({ revision: Revision }), Type.Null()]),
})

const briefRead = {
  /** The sealed revision for the brief the session started from; omit for the current view. */
  revision: Type.Optional(Revision),
  page_token: Type.Optional(BriefPageToken),
}

/** Research and Images under `/7`: read a lot of the session's brief. */
export const SessionReadLotArgs = object({ lot_id: Id, ...briefRead })

/** `read_batch` for a `/7` Examine lead, which pages its brief; earlier leads take no arguments. */
export const SessionReadBriefBatchArgs = object({ ...briefRead })

export const briefSchemas = {
  SessionBrief,
  SealedBrief,
  BriefPage,
  SessionBriefPage,
  SessionReadLotArgs,
  SessionReadBriefBatchArgs,
}

export type BriefStageDto = Static<typeof BriefStage>
export type BriefSectionNameDto = Static<typeof BriefSectionName>
export type BriefEntryDto = Static<typeof BriefEntry>
export type SessionBriefDto = Static<typeof SessionBrief>
export type SealedBriefDto = Static<typeof SealedBrief>
export type BriefPageDto = Static<typeof BriefPage>
export type SessionBriefPageDto = Static<typeof SessionBriefPage>
export type SessionReadLotArgsDto = Static<typeof SessionReadLotArgs>
export type SessionReadBriefBatchArgsDto = Static<typeof SessionReadBriefBatchArgs>
