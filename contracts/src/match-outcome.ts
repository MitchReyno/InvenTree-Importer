import { Type, type Static, type TProperties } from '@sinclair/typebox'
import { Digest, Id, PositivePk, Revision } from './scalars.ts'

const object = <T extends TProperties>(properties: T) =>
  Type.Object(properties, { additionalProperties: false })

/** The Part fields gaps mode may fill through Research; Images fills the Part image. */
export const RESEARCH_GAP_FIELDS = ['datasheet', 'parameters'] as const

const researchFull = object({ stage: Type.Literal('research'), mode: Type.Literal('full') })
const researchGaps = object({
  stage: Type.Literal('research'),
  mode: Type.Literal('gaps'),
  fields: Type.Array(Type.Union(RESEARCH_GAP_FIELDS.map((field) => Type.Literal(field))), {
    minItems: 1,
    maxItems: RESEARCH_GAP_FIELDS.length,
    uniqueItems: true,
  }),
})
const imagesFull = object({ stage: Type.Literal('images'), mode: Type.Literal('full') })
/** Stock images, and the Part image only when the matched Part has none. */
const imagesStock = object({
  stage: Type.Literal('images'),
  mode: Type.Literal('stock'),
  part_image: Type.Boolean(),
})

/**
 * The mode a `/7` Research or Images session works in. Identify mode is Research's before Match
 * has a key to search with; full and gaps follow a clean search or a decision.
 */
export const StageMode = Type.Union([
  object({ stage: Type.Literal('research'), mode: Type.Literal('identify') }),
  researchFull,
  researchGaps,
  imagesFull,
  imagesStock,
])

export const MatchDecision = Type.Union(
  (['new_part', 'fill_gaps', 'add_stock', 'already_imported'] as const).map((decision) =>
    Type.Literal(decision),
  ),
)

/** A clear search, or the operator's decision on the candidates. */
export const MatchOutcomeBasis = Type.Union([
  object({ kind: Type.Literal('clear') }),
  object({ kind: Type.Literal('decision'), decision: MatchDecision }),
])

/**
 * A lot's persisted Match outcome: a clear verdict or a decision, with the stage modes it sets.
 * Its revision advances only when the outcome changes, so a search with an equivalent result
 * keeps the proposals pinned to it current.
 */
export const MatchOutcome = object({
  schema_version: Type.Literal('bench-intake-match-outcome/1'),
  lot_id: Id,
  revision: Revision,
  basis: MatchOutcomeBasis,
  research: Type.Union([
    researchFull,
    researchGaps,
    object({ stage: Type.Literal('research'), mode: Type.Literal('skipped') }),
  ]),
  images: Type.Union([
    imagesFull,
    imagesStock,
    object({ stage: Type.Literal('images'), mode: Type.Literal('skipped') }),
  ]),
})

/**
 * What a `/7` Research or Images input seals of Match: the outcome it was queued under, or null
 * when there is none, and the stage's mode. `research/1` and `images/1` pin both.
 */
/**
 * What Match's state for a lot depends on in Capture: its Part subject, the InvenTree Part that
 * subject selects, and for a lot the operator added without evidence a digest of the identifiers
 * its draft confirms. Examine's lots are identified by their pinned proposal instead.
 */
export const MatchBinding = object({
  part_subject_id: Type.Union([Id, Type.Null()]),
  part_pk: Type.Union([PositivePk, Type.Null()]),
  draft: Type.Union([Digest, Type.Null()]),
})

export const SealedMatch = object({
  outcome: Type.Union([object({ revision: Revision, basis: MatchOutcomeBasis }), Type.Null()]),
  mode: StageMode,
  /** The lot's Capture binding the attempt was queued under; a changed one holds the attempt. */
  binding: Type.Optional(MatchBinding),
})

export const matchOutcomeSchemas = { StageMode, MatchOutcome, MatchBinding, SealedMatch }

export type StageModeDto = Static<typeof StageMode>
export type MatchOutcomeDto = Static<typeof MatchOutcome>
export type SealedMatchDto = Static<typeof SealedMatch>
export type MatchBindingDto = Static<typeof MatchBinding>
export type MatchDecisionDto = Static<typeof MatchDecision>
export type MatchOutcomeBasisDto = Static<typeof MatchOutcomeBasis>
