import { Type, type Static, type TProperties } from '@sinclair/typebox'
import { Digest, Id, IsoTime, PositivePk, Quantity, Revision } from './scalars.ts'
import { CaptureDefaults, CaptureQuantity, LotExclusion } from './capture.ts'
import { InventoryMapping } from './effects.ts'
import { note } from './capture-primitives.ts'
import {
  CaptureEvidenceObservation,
  EvidenceReadings,
  EvidenceRegion,
} from './evidence-observations.ts'
import { RetainedSessionProposal } from './processing.ts'
import { StepInstructionsText } from './step-instructions.ts'
import { MatchLot } from './match.ts'

const object = <T extends TProperties>(properties: T) =>
  Type.Object(properties, { additionalProperties: false })

/**
 * A `/7` session's brief: what it is given before it starts, sealed into its input. The shared
 * sections come first, then its stage's. The Match section holds the lot's Match state, or every
 * lot's for Examine.
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

/** The batch's or its order's saved note, from the batch settings, as the operator last saved it. */
export const BriefSettingNoteEntry = object({
  kind: Type.Literal('setting_note'),
  ...human,
  scope: Type.Union([Type.Literal('batch'), Type.Literal('order')]),
  version: Revision,
  text: Type.String({ minLength: 1, maxLength: 8192 }),
  text_sha256: Digest,
  actor_id: Id,
  created_at: Type.String({ minLength: 1, maxLength: 64 }),
})

/**
 * The operator's saved instructions for this step, as the input sealed them at queue time: their
 * guidance for this step, followed after the app's own rules and the stage pack.
 */
export const BriefStepGuidanceEntry = object({
  kind: Type.Literal('step_guidance'),
  ...human,
  stage: BriefStage,
  text: StepInstructionsText,
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
 * An observation's reading was corrected: by the operator, or (`source: agent`) by the Examine
 * session revising its own observation. `before` is the reading it replaced, or null when the
 * correction was made before earlier readings were kept (`earlier_known` false).
 */
export const BriefCorrectionEntry = object({
  kind: Type.Literal('correction'),
  source: Type.Union([Type.Literal('human'), Type.Literal('agent')]),
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
  /**
   * Identifies this state of the lot, `lot:<lot_id>:<digest>`, from its facts below: an entry
   * with the same id says the same thing, and any change gives a new id.
   */
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
  /**
   * Why the lot is flagged, from the operator's edits since the lead last looked at it: an
   * observation edited, or a same-item mark set or cleared. Empty for a flag set before reasons
   * were kept.
   */
  reexamine_reasons: Type.Array(
    object({
      reason: Type.Union([Type.Literal('observation_edited'), Type.Literal('same_item_changed')]),
      observation_id: Id,
      revision: Revision,
    }),
    { maxItems: 100 },
  ),
  /** Earlier reasons left out of `reexamine_reasons`, which lists the most recent. */
  reexamine_reasons_omitted: Type.Integer({ minimum: 0 }),
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
  proposal: RetainedSessionProposal,
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

/** The catalogue models a Research session can cite from its vocabulary. */
export const VOCABULARY_KINDS = [
  'category',
  'parameter_template',
  'category_parameter',
  'company',
] as const
export const VocabularyKind = Type.Union(VOCABULARY_KINDS.map((kind) => Type.Literal(kind)))

/**
 * Research: a catalogue record the batch has observed, with the reference a proposal cites for
 * it. A category, parameter template, category mapping or company; never a Part or location.
 */
export const BriefVocabularyEntry = object({
  kind: Type.Literal('vocabulary'),
  reference: object({
    observation_id: Id,
    target_context_id: Id,
    model: VocabularyKind,
    pk: PositivePk,
  }),
  label: Type.String({ minLength: 1, maxLength: 256 }),
  mapping: Type.Optional(InventoryMapping),
})

/** A lot's Match state: what it was searched with, what was found and what runs in which mode. */
export const BriefMatchEntry = object({ kind: Type.Literal('match'), match: MatchLot })

export const BriefEntry = Type.Union([
  BriefBatchEntry,
  BriefInstructionEntry,
  BriefNoteEntry,
  BriefSettingNoteEntry,
  BriefStepGuidanceEntry,
  BriefAnswerEntry,
  BriefCorrectionEntry,
  BriefLotEditEntry,
  BriefQuestionEntry,
  BriefEvidenceEntry,
  BriefObservationEntry,
  BriefLotEntry,
  BriefPartEntry,
  BriefIdentityEntry,
  BriefVocabularyEntry,
  BriefKeepOutEntry,
  BriefMatchEntry,
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

/** A stage guide section's name, as the guide table stores it. */
export const GUIDE_SECTION_NAME = Type.String({ pattern: '^[a-z][a-z0-9-]{0,47}$' })

/** `read_guide`: a section of the stage's guide by name, or none to list the sections. */
export const SessionReadGuideArgs = object({
  section: Type.Optional(GUIDE_SECTION_NAME),
})

/** The most entries one `read_vocabulary` page returns. */
export const VOCABULARY_PAGE_MAX_ENTRIES = 50

/** The longest `read_vocabulary` search, matched against labels regardless of case. */
export const VOCABULARY_SEARCH_MAX_CHARACTERS = 100

/**
 * `read_vocabulary`: the batch's catalogue records, optionally of one kind and matching a search,
 * a page at a time. A page token continues the same kind and search.
 */
export const SessionReadVocabularyArgs = object({
  kind: Type.Optional(VocabularyKind),
  search: Type.Optional(Type.String({ minLength: 1, maxLength: VOCABULARY_SEARCH_MAX_CHARACTERS })),
  page_token: Type.Optional(BriefPageToken),
})

export const briefSchemas = {
  SessionBrief,
  SealedBrief,
  BriefPage,
  SessionBriefPage,
  SessionReadLotArgs,
  SessionReadBriefBatchArgs,
  SessionReadGuideArgs,
  SessionReadVocabularyArgs,
}

export type BriefStageDto = Static<typeof BriefStage>
export type BriefSectionNameDto = Static<typeof BriefSectionName>
export type BriefEntryDto = Static<typeof BriefEntry>
export type BriefQuestionEntryDto = Static<typeof BriefQuestionEntry>
export type BriefAnswerEntryDto = Static<typeof BriefAnswerEntry>
export type SessionBriefDto = Static<typeof SessionBrief>
export type SealedBriefDto = Static<typeof SealedBrief>
export type BriefPageDto = Static<typeof BriefPage>
export type SessionBriefPageDto = Static<typeof SessionBriefPage>
export type SessionReadLotArgsDto = Static<typeof SessionReadLotArgs>
export type SessionReadGuideArgsDto = Static<typeof SessionReadGuideArgs>
export type SessionReadVocabularyArgsDto = Static<typeof SessionReadVocabularyArgs>
export type BriefVocabularyEntryDto = Static<typeof BriefVocabularyEntry>
export type VocabularyKindDto = Static<typeof VocabularyKind>
export type SessionReadBriefBatchArgsDto = Static<typeof SessionReadBriefBatchArgs>
