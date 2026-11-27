import { Type, type Static, type TProperties } from '@sinclair/typebox'
import { Id, IsoTime, PositivePk, Quantity, Revision } from './scalars.ts'
import { MatchDecision, MatchOutcome } from './match-outcome.ts'
import { QuestionStepId, QuestionStepValue, QuestionSteps, QuestionTitle } from './processing.ts'

const object = <T extends TProperties>(properties: T) =>
  Type.Object(properties, { additionalProperties: false })

const keyText = Type.String({ minLength: 1, maxLength: 100, pattern: '^[^\\x00-\\x1f\\x7f]*$' })
const label = Type.String({ minLength: 1, maxLength: 256 })
const shown = Type.String({ minLength: 1, maxLength: 512 })

/**
 * A key Match searches with. An MPN or type with a manufacturer, an NSN, an IPN or a SKU is
 * strong; an MPN alone is weak, and a batch code only narrows a candidate Part's stock.
 */
export const MatchKey = Type.Union([
  object({
    kind: Type.Literal('mpn'),
    mpn: keyText,
    manufacturer: Type.Optional(keyText),
    /** The InvenTree company the operator confirmed, when the key is theirs. */
    manufacturer_pk: Type.Optional(PositivePk),
  }),
  object({ kind: Type.Literal('type'), type: keyText, manufacturer: keyText }),
  object({
    kind: Type.Literal('nsn'),
    nsn: Type.String({ pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{3}-[0-9]{4}$' }),
  }),
  object({ kind: Type.Literal('ipn'), ipn: keyText }),
  object({
    kind: Type.Literal('sku'),
    sku: keyText,
    supplier: Type.Optional(keyText),
    supplier_pk: Type.Optional(PositivePk),
  }),
  object({ kind: Type.Literal('batch_code'), batch_code: keyText }),
])

/** How a candidate matched one of the lot's keys. */
export const MatchReason = Type.Union(
  (
    [
      'mpn_and_manufacturer',
      'mpn_only',
      'type_and_manufacturer',
      'nsn_stock_tag',
      'ipn',
      'sku',
      'batch_code',
      'name',
    ] as const
  ).map((reason) => Type.Literal(reason)),
)

/** What an existing Part lacks; a datasheet, key parameters and the Part image can be filled. */
export const MatchMissing = Type.Union([
  object({ kind: Type.Literal('datasheet') }),
  object({ kind: Type.Literal('part_image') }),
  object({ kind: Type.Literal('manufacturer_part') }),
  object({ kind: Type.Literal('supplier_part') }),
  object({ kind: Type.Literal('parameter'), template: PositivePk, name: Type.Optional(label) }),
])

export const MAX_MATCH_CANDIDATES = 5
export const MAX_MATCH_CANDIDATE_STOCK = 5

/** An InvenTree Part that may be this lot, with why and what it lacks. */
export const MatchPartCandidate = object({
  kind: Type.Literal('part'),
  part: object({
    pk: PositivePk,
    name: label,
    ipn: Type.Optional(label),
    has_image: Type.Boolean(),
  }),
  verdict: Type.Union([Type.Literal('exact'), Type.Literal('possible'), Type.Literal('duplicate')]),
  matched_by: Type.Array(object({ key: MatchKey, reason: MatchReason }), {
    minItems: 1,
    maxItems: 16,
  }),
  /** At most the category's 100 mappings and the four other gaps. */
  missing: Type.Array(MatchMissing, { maxItems: 104 }),
  /** Whether the category's key parameters could be read; when not, none is listed as missing. */
  parameters_known: Type.Boolean(),
  /** The Part's stock with the lot's batch code. */
  stock: Type.Array(
    object({ pk: PositivePk, batch: keyText, quantity: Type.Union([Quantity, Type.Literal('0')]) }),
    { maxItems: MAX_MATCH_CANDIDATE_STOCK },
  ),
})

/** An unapproved lot in another batch of the same actor, target and context. */
export const MatchLotCandidate = object({
  kind: Type.Literal('lot'),
  batch_id: Id,
  batch_title: label,
  lot_id: Id,
  lot_label: label,
  matched_by: Type.Array(object({ key: MatchKey, reason: MatchReason }), {
    minItems: 1,
    maxItems: 16,
  }),
})

export const MatchCandidate = Type.Union([MatchPartCandidate, MatchLotCandidate])

/**
 * An approval of the lot's own original contribution. The run and its stock are named only when
 * the operator may read that run.
 */
export const MatchContributionHit = Type.Union([
  object({
    readable: Type.Literal(true),
    run_id: Id,
    /** The batch whose Changes › Added lists the run. */
    batch_id: Id,
    stock: Type.Union(
      (['created', 'not_created', 'uncertain', 'deleted', 'unavailable'] as const).map((state) =>
        Type.Literal(state),
      ),
    ),
  }),
  object({ readable: Type.Literal(false) }),
])

/** What a lot's identity is, for Match: Examine's, the operator's confirmed one, or none yet. */
export const MatchIdentity = Type.Union([
  object({ kind: Type.Literal('examine'), proposal_id: Id }),
  object({ kind: Type.Literal('operator'), revision: Revision }),
])

export const MatchState = Type.Union(
  (['searching', 'unavailable', 'clear', 'question', 'decided', 'held'] as const).map((state) =>
    Type.Literal(state),
  ),
)

export const MatchStage = Type.Union([Type.Literal('research'), Type.Literal('images')])

/** A lot as Match has it now. */
export const MatchLot = object({
  lot_id: Id,
  identity: MatchIdentity,
  /** `searching` while a search is requested and not settled; `held` after Something else. */
  state: MatchState,
  /** The latest requested search, and the latest one that settled. */
  generation: Revision,
  settled_generation: Type.Union([Revision, Type.Literal('0')]),
  keys: Type.Array(MatchKey, { maxItems: 32 }),
  /** Whether any key is strong; without one only the import reference is looked up. */
  searchable: Type.Boolean(),
  verdict: Type.Optional(
    Type.Union(
      (['none', 'exact', 'possible', 'duplicate'] as const).map((verdict) => Type.Literal(verdict)),
    ),
  ),
  candidates: Type.Array(MatchCandidate, { maxItems: MAX_MATCH_CANDIDATES }),
  contribution: Type.Optional(MatchContributionHit),
  outcome: Type.Optional(MatchOutcome),
  /** The Part the decision targets, for add stock and fill what's missing. */
  target: Type.Optional(object({ part_pk: PositivePk, name: label })),
  /** The stages Match holds until it settles or the operator decides. */
  waits: Type.Array(MatchStage, { maxItems: 2, uniqueItems: true }),
  question_id: Type.Optional(Id),
  searched_at: Type.Optional(IsoTime),
  decided_at: Type.Optional(IsoTime),
})

/** What a match question asks about. */
export const MatchQuestionKind = Type.Union(
  (['candidates', 'contribution', 'unresolved', 'target_lost'] as const).map((kind) =>
    Type.Literal(kind),
  ),
)

/** An agent's judgement about existing records, quoted in the question. */
export const MatchQuestionNote = object({
  stage: Type.Union([Type.Literal('examine'), Type.Literal('research')]),
  kind: Type.Union([Type.Literal('alias'), Type.Literal('relation'), Type.Literal('negative')]),
  text: shown,
})

/** The operator's answer as Match recorded it. */
export const MatchAnswerRecord = object({
  answered_at: IsoTime,
  /** The decision, or none for Something else. */
  decision: Type.Optional(MatchDecision),
  part_pk: Type.Optional(PositivePk),
  /** Something else, in the operator's words. */
  text: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
  /** Answered with others in one batch answer. */
  batch: Type.Optional(Type.Literal(true)),
})

/**
 * An app-owned question on one lot, pinned to the search it was asked from. Its one step is
 * BI-019's stepped form; its options name what each answer does.
 */
export const MatchQuestion = object({
  id: Id,
  lot_id: Id,
  /** The search generation it was asked from; an answer names it. */
  revision: Revision,
  state: Type.Union([Type.Literal('open'), Type.Literal('answered'), Type.Literal('superseded')]),
  kind: MatchQuestionKind,
  title: QuestionTitle,
  reason: Type.String({ minLength: 1, maxLength: 2048 }),
  steps: QuestionSteps,
  keys: Type.Array(MatchKey, { maxItems: 32 }),
  candidates: Type.Array(MatchCandidate, { maxItems: MAX_MATCH_CANDIDATES }),
  notes: Type.Array(MatchQuestionNote, { maxItems: 32 }),
  contribution: Type.Optional(MatchContributionHit),
  asked_at: IsoTime,
  answer: Type.Optional(MatchAnswerRecord),
})

/** A batch's Match step: each lot's state and its questions, newest search first per lot. */
export const BatchMatch = object({
  batch_id: Id,
  capture_revision: Revision,
  /** Whether the batch's pipeline is `/7`'s, with Match in place of the Inventory step. */
  pipeline: Type.Union([Type.Literal('match'), Type.Literal('inventory')]),
  lots: Type.Array(MatchLot, { maxItems: 100 }),
  questions: Type.Array(MatchQuestion, { maxItems: 200 }),
})

/** An answer to one match question: its one step's value. */
export const MatchAnswer = object({
  expected_question_revision: Revision,
  steps: Type.Array(object({ step_id: QuestionStepId, value: QuestionStepValue }), {
    minItems: 1,
    maxItems: 1,
  }),
})

/** Several exact matches answered as one: each question's option, applied together or not at all. */
export const MatchBatchAnswer = object({
  answers: Type.Array(
    object({
      question_id: Id,
      expected_question_revision: Revision,
      option_id: QuestionStepId,
    }),
    { minItems: 2, maxItems: 100 },
  ),
})

export const MatchAnswerReceipt = object({
  batch_id: Id,
  question_ids: Type.Array(Id, { minItems: 1, maxItems: 100 }),
  capture_revision: Revision,
})

/** Asks Match to search the lots again. */
export const MatchCheck = object({
  lot_ids: Type.Array(Id, { minItems: 1, maxItems: 100, uniqueItems: true }),
})

/** Decide again: asks a decided lot's question afresh from its latest search. */
export const MatchReopen = object({})

export const MatchCheckReceipt = object({
  batch_id: Id,
  lots: Type.Array(object({ lot_id: Id, generation: Revision }), { minItems: 1, maxItems: 100 }),
})

export const matchSchemas = {
  MatchKey,
  MatchIdentity,
  MatchCandidate,
  MatchLot,
  MatchQuestion,
  BatchMatch,
  MatchAnswer,
  MatchBatchAnswer,
  MatchAnswerReceipt,
  MatchCheck,
  MatchReopen,
  MatchCheckReceipt,
}

export type MatchKeyDto = Static<typeof MatchKey>
export type MatchReasonDto = Static<typeof MatchReason>
export type MatchMissingDto = Static<typeof MatchMissing>
export type MatchPartCandidateDto = Static<typeof MatchPartCandidate>
export type MatchLotCandidateDto = Static<typeof MatchLotCandidate>
export type MatchCandidateDto = Static<typeof MatchCandidate>
export type MatchContributionHitDto = Static<typeof MatchContributionHit>
export type MatchIdentityDto = Static<typeof MatchIdentity>
export type MatchStateDto = Static<typeof MatchState>
export type MatchStageDto = Static<typeof MatchStage>
export type MatchLotDto = Static<typeof MatchLot>
export type MatchQuestionKindDto = Static<typeof MatchQuestionKind>
export type MatchQuestionNoteDto = Static<typeof MatchQuestionNote>
export type MatchAnswerRecordDto = Static<typeof MatchAnswerRecord>
export type MatchQuestionDto = Static<typeof MatchQuestion>
export type BatchMatchDto = Static<typeof BatchMatch>
export type MatchAnswerDto = Static<typeof MatchAnswer>
export type MatchBatchAnswerDto = Static<typeof MatchBatchAnswer>
export type MatchAnswerReceiptDto = Static<typeof MatchAnswerReceipt>
export type MatchCheckDto = Static<typeof MatchCheck>
export type MatchCheckReceiptDto = Static<typeof MatchCheckReceipt>
