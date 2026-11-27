import { Type, type Static, type TProperties } from '@sinclair/typebox'
import { CursorSequence, Digest, Id, IsoTime, Quantity, Revision } from './scalars.ts'
import { CaptureDefaults, CaptureSnapshot } from './capture.ts'
import { captureTags } from './capture-primitives.ts'
import { AgentSelection, OneTurnAgentSelection } from './agent-selection.ts'
import { ResearchReceiptSource } from './research.ts'
import { mappedReference } from './effects.ts'
import { valueEvidence } from './value-evidence.ts'
import { MediaLitViewRecipe, MediaViewGeometry, MediaViewMarks } from './media.ts'
import { StepInstructionsText } from './step-instructions.ts'

const object = <T extends TProperties>(properties: T) =>
  Type.Object(properties, { additionalProperties: false })

const text = Type.String({ minLength: 1, maxLength: 2048 })
const stages = ['reading', 'identifying', 'research', 'images', 'inventory'] as const
export const ProcessingStage = Type.Union(stages.map((stage) => Type.Literal(stage)))
/** Stages of the session profiles. Earlier input versions keep `ProcessingStage` unchanged. */
export const ProcessingStageV2 = Type.Union(
  (['examine', ...stages] as const).map((stage) => Type.Literal(stage)),
)
const lotStages = ['research', 'images', 'inventory'] as const
export const ProcessingState = Type.Union(
  (
    [
      'queued',
      'running',
      'waiting_for_user',
      'waiting_for_login',
      'waiting_for_capacity',
      'ready',
      'failed',
      'cancelled',
      'superseded',
      'interrupted',
    ] as const
  ).map((state) => Type.Literal(state)),
)
/** A session's lifecycle state; sessions.ts re-exports it with the session contracts. */
export const SessionState = Type.Union(
  (
    [
      'queued',
      'running',
      'waiting_input',
      'finished',
      'cancelling',
      'cancelled',
      'interrupted',
      'failed',
      'waiting_for_login',
      'waiting_for_capacity',
      'resume_unavailable',
    ] as const
  ).map((state) => Type.Literal(state)),
)
export const ProcessingStart = object({
  schema_version: Type.Literal('bench-intake-processing/1'),
  expected_capture_revision: Revision,
  subject_ids: Type.Array(Id, { minItems: 1, maxItems: 20, uniqueItems: true }),
  stages: Type.Array(ProcessingStage, { minItems: 1, maxItems: 5, uniqueItems: true }),
})
export const ProcessingInputV1 = object({
  schema_version: Type.Literal('bench-intake-input/1'),
  batch_id: Id,
  source_id: Id,
  capture_revision: Revision,
  subject_id: Id,
  stage: ProcessingStage,
  dependencies: Type.Array(Id, { maxItems: 5, uniqueItems: true }),
  answer_id: Type.Union([Id, Type.Null()]),
  defaults: CaptureDefaults,
  subject: Type.Union([
    CaptureSnapshot.properties.lots.items,
    CaptureSnapshot.properties.parts.items,
  ]),
  linked_part: Type.Union([CaptureSnapshot.properties.parts.items, Type.Null()]),
  notes: Type.Array(CaptureSnapshot.properties.notes.items, { minItems: 1, maxItems: 1000 }),
  observations: CaptureSnapshot.properties.observations,
  profile_id: Type.Literal('synthetic-research/1'),
  instruction_version: Type.Literal('restricted-synthetic/1'),
  instruction_sha256: Digest,
  tool_profile_version: Type.Literal('restricted-no-tools/1'),
  media: Type.Array(Id, { maxItems: 0 }),
})
export const ProcessingInputV2 = object({
  ...ProcessingInputV1.properties,
  schema_version: Type.Literal('bench-intake-input/2'),
  profile_id: Type.Literal('synthetic-research/2'),
  instruction_version: Type.Literal('restricted-synthetic/2'),
  notes: Type.Array(CaptureSnapshot.properties.notes.items, { maxItems: 1000 }),
  media: object({ manifest: Type.String({ minLength: 1, maxLength: 245760 }), sha256: Digest }),
})
export const ProcessingInputV3 = object({
  ...ProcessingInputV2.properties,
  schema_version: Type.Literal('bench-intake-input/3'),
  profile_id: Type.Literal('restricted-research-stub/1'),
  instruction_version: Type.Literal('restricted-research-stub/1'),
  tool_profile_version: Type.Literal('restricted-research-tools/1'),
  source_urls: Type.Array(Type.String({ minLength: 1, maxLength: 2048 }), {
    maxItems: 16,
    uniqueItems: true,
  }),
})
export const ProcessingInputV4 = object({
  ...ProcessingInputV2.properties,
  schema_version: Type.Literal('bench-intake-input/4'),
  profile_id: Type.Literal('native-agent/1'),
  instruction_version: Type.Literal('native-agent/1'),
  tool_profile_version: Type.Literal('native-no-tools/1'),
  agent: OneTurnAgentSelection,
  settings_revision: Revision,
})
/**
 * The synthetic `/2` handler's input when the subject or its linked Part chooses to create a new
 * Part, so suggestions for that Part stay current. Older versions never carry a create choice.
 */
export const ProcessingInputV5 = object({
  ...ProcessingInputV2.properties,
  schema_version: Type.Literal('bench-intake-input/5'),
})
/** The fields every session input shares; `/7` adds to them (`stage-input.ts`). */
export const inputV6Shared = {
  schema_version: Type.Literal('bench-intake-input/6'),
  batch_id: Id,
  source_id: Id,
  capture_revision: Revision,
  defaults: CaptureDefaults,
  notes: ProcessingInputV2.properties.notes,
  observations: CaptureSnapshot.properties.observations,
  instruction_sha256: Digest,
  media: ProcessingInputV2.properties.media,
  /** Proposals a successor started from; later revisions arrive as inbox items. */
  pinned_proposal_ids: Type.Array(Id, { maxItems: 16, uniqueItems: true }),
  /** Web settings sealed at queue time; absent on earlier attempts, which run with both off. */
  web: Type.Optional(
    object({
      public_pages: Type.Boolean(),
      prefer_datasheets: Type.Boolean(),
    }),
  ),
  /** The saved Part description style, sealed at queue time; absent when none was saved. */
  part_description_style: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
  /**
   * The operator's saved instructions for this input's step, sealed at queue time; absent when
   * none were saved, for a step that takes none, and on earlier attempts.
   */
  stage_instructions: Type.Optional(StepInstructionsText),
}
/** Each profile seals its own tool profile; only `shared-vm-agent/3` has the web tools. */
const sessionTools = Type.Literal('native-session-tools/1')
const inputV6Profiles = [
  {
    profile_id: Type.Literal('native-agent/2'),
    instruction_version: Type.Literal('native-agent/2'),
    tool_profile_version: sessionTools,
    agent: AgentSelection,
    settings_revision: Revision,
  },
  {
    profile_id: Type.Literal('shared-vm-agent/1'),
    instruction_version: Type.Literal('shared-vm-agent/1'),
    tool_profile_version: sessionTools,
    agent: AgentSelection,
    settings_revision: Revision,
  },
  {
    profile_id: Type.Literal('shared-vm-agent/2'),
    instruction_version: Type.Literal('shared-vm-agent/2'),
    tool_profile_version: sessionTools,
    agent: AgentSelection,
    settings_revision: Revision,
  },
  {
    profile_id: Type.Literal('shared-vm-agent/3'),
    instruction_version: Type.Literal('shared-vm-agent/3'),
    tool_profile_version: Type.Literal('native-session-web-tools/1'),
    agent: AgentSelection,
    settings_revision: Revision,
  },
  {
    profile_id: Type.Literal('synthetic-session/1'),
    instruction_version: Type.Literal('synthetic-session/1'),
    tool_profile_version: sessionTools,
    agent: Type.Null(),
    settings_revision: Type.Null(),
  },
]
/** The lead's and a lot session's scope fields, as `/6` seals them. */
export const inputV6Scopes = [
  {
    stage: Type.Literal('examine'),
    subject_id: Type.Null(),
    subject: Type.Null(),
    linked_part: Type.Null(),
  },
  {
    stage: Type.Union(lotStages.map((stage) => Type.Literal(stage))),
    subject_id: Id,
    subject: ProcessingInputV2.properties.subject,
    linked_part: ProcessingInputV2.properties.linked_part,
  },
]
/**
 * A session's opening manifest: the batch-level Examine lead session, or one per-lot session.
 * Only the session handler decodes it, so it is not part of `ProcessingInput`.
 */
export const ProcessingInputV6 = Type.Union(
  inputV6Profiles.flatMap((profile) =>
    inputV6Scopes.map((scope) => object({ ...inputV6Shared, ...profile, ...scope })),
  ),
)
export const ProcessingInput = Type.Union([
  ProcessingInputV1,
  ProcessingInputV2,
  ProcessingInputV5,
  ProcessingInputV3,
  ProcessingInputV4,
  ProcessingInputV5,
])

export const ProcessingCommandV1 = object({
  schema_version: Type.Literal('bench-intake-processing-command/1'),
  job_id: Id,
  attempt_id: Id,
  input_id: Id,
  input_sha256: Digest,
  profile_id: Type.Literal('synthetic-research/1'),
  handler_version: Type.Literal('processing/1'),
  command_id: Id,
})
export const ProcessingCommandV2 = object({
  ...ProcessingCommandV1.properties,
  schema_version: Type.Literal('bench-intake-processing-command/2'),
  profile_id: Type.Literal('synthetic-research/2'),
  handler_version: Type.Literal('processing/2'),
})
export const ProcessingCommandV3 = object({
  ...ProcessingCommandV2.properties,
  schema_version: Type.Literal('bench-intake-processing-command/3'),
  profile_id: Type.Literal('restricted-research-stub/1'),
  handler_version: Type.Literal('processing/3'),
})
export const ProcessingCommandV4 = object({
  ...ProcessingCommandV2.properties,
  schema_version: Type.Literal('bench-intake-processing-command/4'),
  profile_id: Type.Literal('native-agent/1'),
  handler_version: Type.Literal('processing/4'),
})
export const ProcessingCommandV5 = object({
  ...ProcessingCommandV2.properties,
  schema_version: Type.Literal('bench-intake-processing-command/5'),
  profile_id: Type.Union([
    Type.Literal('native-agent/2'),
    Type.Literal('shared-vm-agent/1'),
    Type.Literal('shared-vm-agent/2'),
    Type.Literal('shared-vm-agent/3'),
    Type.Literal('synthetic-session/1'),
  ]),
  handler_version: Type.Literal('processing/5'),
})
export const ProcessingCommand = Type.Union([
  ProcessingCommandV5,
  ProcessingCommandV4,
  ProcessingCommandV1,
  ProcessingCommandV2,
  ProcessingCommandV3,
])

export const ProcessingCancellation = object({
  expected_revision: Revision,
  attempt_id: Id,
})
export const ProcessingQuestionValue = Type.Union([
  object({
    kind: Type.Literal('quantity'),
    value: Quantity,
    basis: Type.Union([Type.Literal('counted'), Type.Literal('estimated')]),
  }),
  object({ kind: Type.Literal('clarification'), text }),
])
/** An answer to an earlier runner question or a `/1` session question: one value. */
export const ProcessingAnswerV1 = object({
  schema_version: Type.Literal('bench-intake-answer/1'),
  expected_question_revision: Revision,
  expected_capture_revision: Revision,
  attempt_id: Id,
  input_sha256: Digest,
  value: ProcessingQuestionValue,
})
export const ProcessingQuestionSpec = object({
  kind: Type.Union([Type.Literal('quantity'), Type.Literal('clarification')]),
  subject_id: Id,
  prompt: text,
  reason: text,
})
export const ProcessingProposalV1 = object({
  subject_id: Id,
  summary: text,
  source_note_ids: Type.Array(Id, { minItems: 1, maxItems: 100, uniqueItems: true }),
})
export const ProcessingMediaSource = object({
  kind: Type.Literal('media_version'),
  evidence_id: Id,
  version_id: Id,
  sha256: Digest,
})
export type ProcessingMediaSourceDto = Static<typeof ProcessingMediaSource>

export const ProcessingSource = Type.Union([
  object({ kind: Type.Literal('note'), note_id: Id, text_sha256: Digest }),
  ProcessingMediaSource,
])
export const ProcessingProposalV2 = object({
  schema_version: Type.Literal('bench-intake-proposal/2'),
  subject_id: Id,
  summary: text,
  sources: Type.Array(ProcessingSource, { minItems: 1, maxItems: 100, uniqueItems: true }),
})
export const ProcessingSourceV3 = Type.Union([ProcessingSource, ResearchReceiptSource])
export const ProcessingProposalV3 = object({
  ...ProcessingProposalV2.properties,
  schema_version: Type.Literal('bench-intake-proposal/3'),
  sources: Type.Array(ProcessingSourceV3, { minItems: 1, maxItems: 100, uniqueItems: true }),
})
/**
 * Reviewable suggestions bound to the same evidence as `/2`. A quantity is only ever an
 * estimate for a human to accept or correct; tags apply only when Auto tags were requested.
 */
export const ProcessingProposalV4 = object({
  ...ProcessingProposalV2.properties,
  schema_version: Type.Literal('bench-intake-proposal/4'),
  quantity: Type.Optional(object({ value: Quantity, status: Type.Literal('estimated') })),
  tags: Type.Optional(captureTags),
})
export const ProcessingField = Type.Union(
  (['markings', 'identity', 'quantity', 'research', 'images'] as const).map((field) =>
    Type.Literal(field),
  ),
)
export const ProcessingFields = Type.Array(ProcessingField, {
  minItems: 1,
  maxItems: 5,
  uniqueItems: true,
})

/** Agent-chosen step and option IDs: short, stable and readable in the agent's own answers. */
export const QuestionStepId = Type.String({ pattern: '^[a-z0-9][a-z0-9_-]{0,39}$' })
export const QUESTION_MAX_STEPS = 4
export const QUESTION_TITLE_MAX_CHARACTERS = 120
/** One step asks one thing, so its prompt stays one question long. */
export const QUESTION_STEP_PROMPT_MAX_CHARACTERS = 500
export const QUESTION_OPTION_LABEL_MAX_CHARACTERS = 80
export const QUESTION_OPTION_DETAIL_MAX_CHARACTERS = 160

/**
 * Text the operator reads, so it must show something. Blank text is refused, and so is text of only
 * spaces, control or format characters (such as a zero-width space) and combining marks.
 */
function shownText(maxLength: number) {
  return Type.String({ minLength: 1, maxLength, pattern: '[^\\s\\p{C}\\p{Z}\\p{M}]' })
}

export const QuestionOption = object({
  id: QuestionStepId,
  label: shownText(QUESTION_OPTION_LABEL_MAX_CHARACTERS),
  detail: Type.Optional(
    Type.String({ minLength: 1, maxLength: QUESTION_OPTION_DETAIL_MAX_CHARACTERS }),
  ),
})
/** How a step is answered: one of 2–6 options, a lot's quantity, or text. */
export const QuestionStepAnswer = Type.Union([
  object({
    kind: Type.Literal('choice'),
    options: Type.Array(QuestionOption, { minItems: 2, maxItems: 6 }),
    /** Whether "Something else" may be answered in words. */
    other: Type.Boolean(),
  }),
  object({ kind: Type.Literal('number') }),
  object({ kind: Type.Literal('text') }),
])
export const QuestionStep = object({
  id: QuestionStepId,
  prompt: shownText(QUESTION_STEP_PROMPT_MAX_CHARACTERS),
  /** What the agent keeps working on until this step is answered. */
  assumption: shownText(2048),
  answer: QuestionStepAnswer,
})
export const QuestionSteps = Type.Array(QuestionStep, { minItems: 1, maxItems: QUESTION_MAX_STEPS })

export const QUESTION_MAX_FIGURES = 5
export const QUESTION_FIGURE_CAPTION_MAX_CHARACTERS = 80
export const QUESTION_FIGURE_WHY_MAX_CHARACTERS = 200
/** A page of an evidence version the batch holds: a photo, or a page of a PDF. */
export const QuestionFigureSource = object({
  kind: Type.Literal('evidence_page'),
  evidence_id: Id,
  version_id: Id,
  page: Type.Integer({ minimum: 1, maximum: 30 }),
})
/**
 * A picture the agent shows with its question: a view of a delivered page, its marks drawn over
 * it, a caption saying what to look at and why it is shown.
 */
export const QuestionFigure = object({
  source: QuestionFigureSource,
  view: MediaViewGeometry,
  marks: Type.Optional(MediaViewMarks),
  caption: shownText(QUESTION_FIGURE_CAPTION_MAX_CHARACTERS),
  why: shownText(QUESTION_FIGURE_WHY_MAX_CHARACTERS),
})
/** Up to five pictures, in the agent's order, most helpful first. */
export const QuestionFigures = Type.Array(QuestionFigure, {
  minItems: 1,
  maxItems: QUESTION_MAX_FIGURES,
})
export const QuestionTitle = shownText(QUESTION_TITLE_MAX_CHARACTERS)
/**
 * One step's answer. A number step takes a quantity or, answered in words, text; every other step
 * takes the value of its own kind.
 */
/** "Something else", answered in the operator's words. */
export const QuestionOtherValue = object({ kind: Type.Literal('choice'), other: text })
export const QuestionNumberValue = object({
  kind: Type.Literal('number'),
  value: Quantity,
  basis: Type.Union([Type.Literal('counted'), Type.Literal('estimated')]),
})
export const QuestionTextValue = object({ kind: Type.Literal('text'), text })
export const QuestionStepValue = Type.Union([
  object({ kind: Type.Literal('choice'), option_id: QuestionStepId }),
  QuestionOtherValue,
  QuestionNumberValue,
  QuestionTextValue,
])
/** An answer to a `/2` session question: one value per step, sent together. */
export const ProcessingAnswerV2 = object({
  schema_version: Type.Literal('bench-intake-answer/2'),
  expected_question_revision: Revision,
  expected_capture_revision: Revision,
  attempt_id: Id,
  input_sha256: Digest,
  // An empty list still reaches the stored question, which names the missing step.
  steps: Type.Array(object({ step_id: QuestionStepId, value: QuestionStepValue }), {
    maxItems: QUESTION_MAX_STEPS,
  }),
})
export const ProcessingAnswer = Type.Union([ProcessingAnswerV1, ProcessingAnswerV2])
/** What a session proposal relies on; it stays current while every source is current. */
export const ProcessingReliance = object({
  fields: ProcessingFields,
  sources: Type.Array(
    Type.Union([
      ...ProcessingSource.anyOf,
      object({
        kind: Type.Literal('evidence_observation'),
        evidence_observation_id: Id,
        revision: Revision,
      }),
      object({ kind: Type.Literal('observation_set'), lot_id: Id, version: Revision }),
      object({ kind: Type.Literal('inbox_item'), inbox_item_id: Id }),
      object({ kind: Type.Literal('proposal'), proposal_id: Id }),
    ]),
    { minItems: 1, maxItems: 200, uniqueItems: true },
  ),
})
const catalogueSources = Type.Array(ProcessingSource, {
  minItems: 1,
  maxItems: 32,
  uniqueItems: true,
})
const catalogueText = Type.String({ minLength: 1, maxLength: 256 })

const catalogueChoice = <M extends 'category' | 'company'>(model: M) =>
  Type.Union([
    object({
      choice: Type.Literal('existing'),
      reference: mappedReference(model),
      sources: catalogueSources,
      ...valueEvidence,
      /** Why this one, and the other choice the step considered. */
      reason: Type.Optional(text),
      alternative: Type.Optional(object({ name: catalogueText, reason: Type.Optional(text) })),
    }),
    object({
      choice: Type.Literal('proposed_new'),
      name: catalogueText,
      reason: text,
      sources: catalogueSources,
      ...valueEvidence,
    }),
  ])

/**
 * Catalogue values with their sources. Whether a value can enter a Part spec is assessed
 * against target observations; unsupported values stay here and are shown with a reason.
 */
export const CatalogueProposal = object({
  category: Type.Union([catalogueChoice('category'), Type.Null()]),
  parameters: Type.Array(
    object({
      name: catalogueText,
      value: catalogueText,
      /** Null proposes a new template, or a template not yet mapped to the category. */
      template: Type.Union([mappedReference('parameter_template'), Type.Null()]),
      category_mapping: Type.Union([mappedReference('category_parameter'), Type.Null()]),
      sources: catalogueSources,
      ...valueEvidence,
      /** Other values the sources gave for it, each with its own sources. */
      alternatives: Type.Optional(
        Type.Array(object({ value: catalogueText, sources: catalogueSources, ...valueEvidence }), {
          minItems: 1,
          maxItems: 4,
        }),
      ),
      /** Why this value was used over its alternatives. */
      chosen_because: Type.Optional(text),
    }),
    { maxItems: 32 },
  ),
  /** The nearest existing Part the step chose not to reuse, and why. */
  not_reused: Type.Optional(
    object({ part: mappedReference('part'), label: catalogueText, reason: text }),
  ),
  /** Templates the category maps that the step found no value for, with why. */
  required_missing: Type.Optional(
    Type.Array(
      object({
        name: catalogueText,
        template: mappedReference('parameter_template'),
        category_mapping: mappedReference('category_parameter'),
        reason: text,
      }),
      { maxItems: 32 },
    ),
  ),
  manufacturer: Type.Union([
    object({
      company: catalogueChoice('company'),
      mpn: catalogueText,
      sources: catalogueSources,
      ...valueEvidence,
    }),
    Type.Null(),
  ]),
  supplier: Type.Union([
    object({
      company: catalogueChoice('company'),
      sku: Type.Union([catalogueText, Type.Null()]),
      price: Type.Union([
        object({ amount: Quantity, currency: Type.String({ pattern: '^[A-Z]{3}$' }) }),
        Type.Null(),
      ]),
      sources: catalogueSources,
      ...valueEvidence,
    }),
    Type.Null(),
  ]),
  description: Type.Union([
    object({ text, sources: catalogueSources, ...valueEvidence }),
    Type.Null(),
  ]),
})
/** A session proposal: `/4` plus what it relies on and a structured catalogue block. */
export const ProcessingProposalV5 = object({
  ...ProcessingProposalV4.properties,
  schema_version: Type.Literal('bench-intake-proposal/5'),
  relies_on: ProcessingReliance,
  catalogue: Type.Optional(CatalogueProposal),
})

/** Agent-reported web pages hold no saved copy, so a URL longer than this is refused. */
export const WEB_PAGE_URL_MAX_CHARACTERS = 2048
/**
 * An absolute http(s) URL without whitespace, control characters or credentials: the authority
 * may not contain `@`. `webPageUrlAccepted` adds the parser's checks the pattern can't express.
 */
const WEB_PAGE_URL_PATTERN =
  '^[Hh][Tt][Tt][Pp][Ss]?://[^\\s\\u0000-\\u001f\\u007f/?#@\\\\]+([/?#][^\\s\\u0000-\\u001f\\u007f]*)?(?![\\s\\S])'
const webPageUrlPattern = new RegExp(WEB_PAGE_URL_PATTERN, 'u')

/** A page the agent says it read, such as a datasheet fetched with WebFetch. Never verified. */
export const WebPageSource = object({
  kind: Type.Literal('web_page'),
  url: Type.String({
    minLength: 1,
    maxLength: WEB_PAGE_URL_MAX_CHARACTERS,
    pattern: WEB_PAGE_URL_PATTERN,
  }),
  title: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
  /** When the agent says it read the page. */
  read_at: Type.Optional(IsoTime),
})
export type WebPageSourceDto = Static<typeof WebPageSource>

/** True when the URL also parses as an absolute http(s) URL with a host and no credentials. */
export function webPageUrlAccepted(value: string): boolean {
  // JSON Schema's maxLength counts code points, not UTF-16 code units.
  const characters = [...value].length
  if (characters > WEB_PAGE_URL_MAX_CHARACTERS || !webPageUrlPattern.test(value)) {
    return false
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  const webScheme = url.protocol === 'https:' || url.protocol === 'http:'
  const noCredentials = url.username === '' && url.password === ''
  return webScheme && noCredentials && url.hostname !== ''
}

/**
 * `/5` plus agent-reported web pages in its top-level sources only; `relies_on` and catalogue
 * sources still cite delivered evidence.
 */
export const ProcessingProposalV6 = object({
  ...ProcessingProposalV5.properties,
  schema_version: Type.Literal('bench-intake-proposal/6'),
  sources: Type.Array(Type.Union([...ProcessingSource.anyOf, WebPageSource]), {
    minItems: 1,
    maxItems: 100,
    uniqueItems: true,
  }),
})
/** The proposal versions a session may publish. */
export const SessionProposal = Type.Union([ProcessingProposalV5, ProcessingProposalV6])

const stageText = Type.String({ minLength: 1, maxLength: 256 })
const stageNote = Type.String({ minLength: 1, maxLength: 512 })
/** A stage output's top-level citations; Research may add agent-reported web pages. */
const stageSources = Type.Array(ProcessingSource, { minItems: 1, maxItems: 100, uniqueItems: true })
const researchSources = Type.Array(Type.Union([...ProcessingSource.anyOf, WebPageSource]), {
  minItems: 1,
  maxItems: 100,
  uniqueItems: true,
})
/** Every typed stage output names its lot, says what it found, cites and relies as `/5` does. */
const stageBase = {
  subject_id: Id,
  summary: text,
  relies_on: ProcessingReliance,
}

/** An identifier a stage read or sourced, which Match may search with. */
export const IdentifierKind = Type.Union(
  (
    [
      'mpn',
      'manufacturer',
      'nsn',
      'ipn',
      'sku',
      'batch_code',
      'house_number',
      'packaging_code',
      'distributor_code',
      'cross_reference',
      'alternate_marking',
    ] as const
  ).map((kind) => Type.Literal(kind)),
)

/**
 * An agent's judgement about existing records, kept apart from Match's search: an alias, a
 * relation to a record, or why something is not the same Part. A key adds to the search.
 */
export const MatchNote = object({
  kind: Type.Union([Type.Literal('alias'), Type.Literal('relation'), Type.Literal('negative')]),
  text: stageNote,
  key: Type.Optional(object({ kind: IdentifierKind, value: stageText })),
  sources: Type.Optional(catalogueSources),
})
const matchNotes = Type.Optional(Type.Array(MatchNote, { minItems: 1, maxItems: 16 }))

/**
 * Examine's finding for one lot: each observation's markings verbatim, ranked identity
 * candidates, the maker, packaging, date code, condition, NOS signals, a visible NSN and the
 * quantity estimate, the only route for one under `/7`.
 */
export const ExamineIdentityV1 = object({
  schema_version: Type.Literal('examine-identity/1'),
  ...stageBase,
  sources: stageSources,
  markings: Type.Array(
    object({
      observation_id: Id,
      text: Type.Array(stageNote, { minItems: 1, maxItems: 32 }),
    }),
    { minItems: 1, maxItems: 100 },
  ),
  /** Most likely first. */
  candidates: Type.Array(
    object({
      mpn: Type.Optional(stageText),
      manufacturer: Type.Optional(stageText),
      type: Type.Optional(stageText),
      description: Type.Optional(stageText),
      confidence: Type.Union([Type.Literal('high'), Type.Literal('medium'), Type.Literal('low')]),
      reason: Type.Optional(stageNote),
    }),
    { maxItems: 8 },
  ),
  maker: Type.Optional(
    object({
      name: stageText,
      /** The logo set's identifier, when a logo was matched. */
      logo_id: Type.Optional(stageText),
      method: Type.Union(
        (['text', 'logo', 'logo_match', 'inferred'] as const).map((method) => Type.Literal(method)),
      ),
    }),
  ),
  packaging: Type.Optional(
    object({
      kind: stageText,
      seal: Type.Union([Type.Literal('sealed'), Type.Literal('opened'), Type.Literal('unknown')]),
    }),
  ),
  date_code: Type.Optional(stageText),
  condition: Type.Optional(stageText),
  nos_signals: Type.Optional(Type.Array(stageText, { minItems: 1, maxItems: 8 })),
  nsn: Type.Optional(Type.String({ pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{3}-[0-9]{4}$' })),
  /** An estimate for the operator to accept or replace, never a count. */
  quantity: Type.Optional(object({ value: Quantity, basis: stageNote })),
  match_notes: matchNotes,
})

/**
 * Research's identity amendment: the canonical MPN, the manufacturer and every alias it sourced,
 * in identify mode or any later one. An unresolved amendment says what it tried.
 */
export const ResearchIdentityV1 = object({
  schema_version: Type.Literal('research-identity/1'),
  ...stageBase,
  sources: researchSources,
  resolution: Type.Union([Type.Literal('resolved'), Type.Literal('unresolved')]),
  mpn: Type.Optional(stageText),
  manufacturer: Type.Optional(stageText),
  aliases: Type.Optional(
    Type.Array(object({ value: stageText, kind: IdentifierKind, sources: catalogueSources }), {
      minItems: 1,
      maxItems: 32,
    }),
  ),
  cross_references: Type.Optional(
    Type.Array(
      object({
        mpn: stageText,
        manufacturer: Type.Optional(stageText),
        relation: Type.Union([
          Type.Literal('equivalent'),
          Type.Literal('replacement'),
          Type.Literal('similar'),
        ]),
        sources: catalogueSources,
      }),
      { minItems: 1, maxItems: 16 },
    ),
  ),
  tried: Type.Optional(Type.Array(stageNote, { minItems: 1, maxItems: 16 })),
  match_notes: matchNotes,
})

const sourcedText = object({ text: stageText, sources: catalogueSources, ...valueEvidence })
const catalogueParameter = CatalogueProposal.properties.parameters.items

/**
 * Research's Part values, each with its sources: what a new Part needs in full mode, or only the
 * fields gaps mode names. A web page may be a top-level source only.
 */
export const ResearchV1 = object({
  schema_version: Type.Literal('research/1'),
  ...stageBase,
  sources: researchSources,
  category: Type.Optional(catalogueChoice('category')),
  name: Type.Optional(sourcedText),
  type: Type.Optional(sourcedText),
  manufacturer: Type.Optional(CatalogueProposal.properties.manufacturer.anyOf[0]),
  description: Type.Optional(object({ text, sources: catalogueSources, ...valueEvidence })),
  parameters: Type.Optional(
    Type.Array(
      object({
        ...catalogueParameter.properties,
        /** Datasheet pages the value was read on. */
        pages: Type.Optional(
          Type.Array(Type.Integer({ minimum: 1, maximum: 10000 }), { minItems: 1, maxItems: 16 }),
        ),
      }),
      { minItems: 1, maxItems: 32 },
    ),
  ),
  datasheet: Type.Optional(
    object({
      url: Type.Optional(WebPageSource.properties.url),
      /** A retained PDF of the batch, when the datasheet is one. */
      version: Type.Optional(ProcessingMediaSource),
      pages: Type.Optional(
        Type.Array(Type.Integer({ minimum: 1, maximum: 10000 }), { minItems: 1, maxItems: 32 }),
      ),
      sources: catalogueSources,
    }),
  ),
  notes: Type.Optional(
    Type.Array(
      object({
        record: Type.Union([Type.Literal('part'), Type.Literal('stock'), Type.Literal('lot')]),
        text,
      }),
      { minItems: 1, maxItems: 16 },
    ),
  ),
  conflicts: Type.Optional(
    Type.Array(
      object({
        field: stageText,
        values: Type.Array(stageText, { minItems: 2, maxItems: 4 }),
        note: Type.Optional(stageNote),
        sources: catalogueSources,
      }),
      { minItems: 1, maxItems: 16 },
    ),
  ),
  /** What the target's configuration lacks for this Part, such as a missing category. */
  config_gaps: Type.Optional(
    Type.Array(
      object({
        kind: Type.Union([
          Type.Literal('category'),
          Type.Literal('parameter_template'),
          Type.Literal('company'),
        ]),
        name: stageText,
        reason: stageNote,
      }),
      { minItems: 1, maxItems: 16 },
    ),
  ),
  match_notes: matchNotes,
})

/** Images' crop recipes: the Part image, stock images and extras, each over one original. */
export const ImagesV1 = object({
  schema_version: Type.Literal('images/1'),
  ...stageBase,
  sources: stageSources,
  images: Type.Array(
    object({
      role: Type.Union([
        Type.Literal('part_image'),
        Type.Literal('stock_image'),
        Type.Literal('extra'),
      ]),
      /** Recipe `/2` has no marks field, so no Images output can carry marks. */
      recipe: MediaLitViewRecipe,
      flags: Type.Optional(Type.Array(stageText, { minItems: 1, maxItems: 8 })),
    }),
    { minItems: 1, maxItems: 10 },
  ),
})

/** The typed outputs of `/7` stage sessions. */
export const StageProposal = Type.Union([
  ExamineIdentityV1,
  ResearchIdentityV1,
  ResearchV1,
  ImagesV1,
])
/** What `propose` publishes in a `/7` session; Images publishes with its own tool. */
export const StagePublishedProposal = Type.Union([
  ExamineIdentityV1,
  ResearchIdentityV1,
  ResearchV1,
])
/** Every proposal a session has published and its readers decode, whatever its input. */
export const RetainedSessionProposal = Type.Union([
  ...SessionProposal.anyOf,
  ...StageProposal.anyOf,
])
/** Every retained proposal version, as Processing shows it; each producer's envelope narrows it. */
export const ProcessingProposal = Type.Union([
  ProcessingProposalV1,
  ProcessingProposalV2,
  ProcessingProposalV3,
  ProcessingProposalV4,
  ProcessingProposalV5,
  ProcessingProposalV6,
  ...StageProposal.anyOf,
])

const runnerBinding = {
  schema_version: Type.Literal('bench-intake-runner/1'),
  job_id: Id,
  attempt_id: Id,
  command_id: Id,
  input_sha256: Digest,
  profile_id: Type.Literal('synthetic-research/1'),
  handler_version: Type.Literal('processing/1'),
  sequence: Revision,
}
const terminalPayload = object({
  state: Type.Union([
    Type.Literal('ready'),
    Type.Literal('failed'),
    Type.Literal('waiting_for_login'),
    Type.Literal('waiting_for_capacity'),
    Type.Literal('interrupted'),
  ]),
})

export const ProcessingEnvelopeV1 = Type.Union(
  [
    object({ ...runnerBinding, kind: Type.Literal('proposal'), payload: ProcessingProposalV1 }),
    object({ ...runnerBinding, kind: Type.Literal('question'), payload: ProcessingQuestionSpec }),
    object({
      ...runnerBinding,
      kind: Type.Literal('terminal'),
      payload: terminalPayload,
    }),
  ],
  { $schema: 'https://json-schema.org/draft/2020-12/schema' },
)
const runnerBindingV2 = {
  ...runnerBinding,
  schema_version: Type.Literal('bench-intake-runner/2'),
  profile_id: Type.Literal('synthetic-research/2'),
  handler_version: Type.Literal('processing/2'),
}
export const ProcessingEnvelopeV2 = Type.Union([
  object({
    ...runnerBindingV2,
    kind: Type.Literal('proposal'),
    payload: Type.Union([ProcessingProposalV2, ProcessingProposalV4]),
  }),
  object({ ...runnerBindingV2, kind: Type.Literal('question'), payload: ProcessingQuestionSpec }),
  object({
    ...runnerBindingV2,
    kind: Type.Literal('terminal'),
    payload: terminalPayload,
  }),
])
const runnerBindingV3 = {
  ...runnerBindingV2,
  schema_version: Type.Literal('bench-intake-runner/3'),
  profile_id: Type.Literal('restricted-research-stub/1'),
  handler_version: Type.Literal('processing/3'),
}
export const ProcessingEnvelopeV3 = Type.Union([
  object({ ...runnerBindingV3, kind: Type.Literal('proposal'), payload: ProcessingProposalV3 }),
  object({ ...runnerBindingV3, kind: Type.Literal('question'), payload: ProcessingQuestionSpec }),
  object({ ...runnerBindingV3, kind: Type.Literal('terminal'), payload: terminalPayload }),
])
const runnerBindingV4 = {
  ...runnerBindingV2,
  schema_version: Type.Literal('bench-intake-runner/4'),
  profile_id: Type.Literal('native-agent/1'),
  handler_version: Type.Literal('processing/4'),
}
export const ProcessingEnvelopeV4 = Type.Union([
  object({ ...runnerBindingV4, kind: Type.Literal('proposal'), payload: ProcessingProposalV2 }),
  object({ ...runnerBindingV4, kind: Type.Literal('question'), payload: ProcessingQuestionSpec }),
  object({ ...runnerBindingV4, kind: Type.Literal('terminal'), payload: terminalPayload }),
])
export const ProcessingEnvelope = Type.Union([
  ProcessingEnvelopeV4,
  ProcessingEnvelopeV1,
  ProcessingEnvelopeV2,
  ProcessingEnvelopeV3,
])
export const ProcessingBlocker = Type.Union([
  Type.Literal('media_not_ready'),
  Type.Literal('media_input_capacity'),
  Type.Literal('worker_version_conflict'),
])

/** What an answer changed in capture: a lot's quantity, a note, or both. */
export const AnswerEffect = Type.Union([
  object({
    kind: Type.Literal('quantity'),
    lot_id: Id,
    value: Quantity,
    basis: Type.Union([Type.Literal('counted'), Type.Literal('estimated')]),
  }),
  object({ kind: Type.Literal('note'), subject_id: Type.Union([Id, Type.Null()]) }),
])
/** An answer summary's prompt and value text keep at most this many code points each. */
export const ANSWER_SUMMARY_TEXT_MAX_CHARACTERS = 200
/** One question's full answer summary, as canonical UTF-8 JSON, escapes included. */
export const MAX_ANSWER_SUMMARY_BYTES = 1024
/**
 * Whether the asking session has acknowledged the answer's inbox item. `read_at` is null while it
 * waits, and for an answer acknowledged before read times were kept.
 */
export const AnswerDelivery = object({
  state: Type.Union([Type.Literal('waiting'), Type.Literal('read')]),
  read_at: Type.Union([IsoTime, Type.Null()]),
})
const summaryText = Type.String({ maxLength: ANSWER_SUMMARY_TEXT_MAX_CHARACTERS })
/**
 * An answered question's answer: in full, or, when the snapshot has no room for its values, only
 * its time and delivery. `delivery` is absent for an earlier runner question, which has no inbox.
 */
export const ProcessingAnswerSummary = Type.Union([
  object({
    answer_id: Id,
    answered_at: IsoTime,
    values: Type.Array(
      object({
        step_id: Type.Union([QuestionStepId, Type.Null()]),
        prompt: summaryText,
        text: summaryText,
        /** The value's text was cut; the full answer stays in the session history. */
        truncated: Type.Boolean(),
      }),
      { minItems: 1, maxItems: QUESTION_MAX_STEPS },
    ),
    effects: Type.Array(AnswerEffect, { maxItems: 2 }),
    delivery: Type.Optional(AnswerDelivery),
  }),
  object({
    answered_at: IsoTime,
    values_omitted: Type.Literal(true),
    delivery: Type.Optional(AnswerDelivery),
  }),
])

const questionBase = {
  id: Id,
  job_id: Id,
  attempt_id: Id,
  input_sha256: Digest,
  revision: Revision,
  state: Type.Union([Type.Literal('open'), Type.Literal('answered'), Type.Literal('superseded')]),
  /** A lead-session question about the whole batch has a null subject. */
  subject_id: Type.Union([Id, Type.Null()]),
  /** When the question was asked; absent for questions retained before the time was kept. */
  asked_at: Type.Optional(IsoTime),
  /** An answered question's answer, while the snapshot has room for it. */
  answer: Type.Optional(ProcessingAnswerSummary),
  /** Whether the job's session history read would serve it now, whatever profile asked this. */
  session_history: Type.Optional(Type.Boolean()),
  /** The later question of the same job that named this one as the question it replaces. */
  replaced_by: Type.Optional(Id),
}
/** An earlier runner question or a `/1` session question: one quantity or clarification prompt. */
export const ProcessingQuestionV1 = object({
  ...questionBase,
  spec: object({
    kind: ProcessingQuestionSpec.properties.kind,
    prompt: ProcessingQuestionSpec.properties.prompt,
    reason: ProcessingQuestionSpec.properties.reason,
  }),
  /** Session questions only: the fields affected and the assumption the agent continues with. */
  fields: Type.Optional(ProcessingFields),
  assumption: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
})
/**
 * A question's picture as the read shows it. `ready` pictures are served by the figure route;
 * `preparing` is still being rendered, `failed` couldn't be made and `removed` names a photo
 * removed from Capture. The page size lets the larger view outline the region on the whole page.
 */
export const ProcessingQuestionFigure = object({
  ...QuestionFigure.properties,
  state: Type.Union(
    (['ready', 'preparing', 'failed', 'removed'] as const).map((state) => Type.Literal(state)),
  ),
  evidence_label: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
  /** Whether the source is a document (a PDF), whose pictures carry a page badge. */
  document: Type.Boolean(),
  page_width: Type.Integer({ minimum: 1 }),
  page_height: Type.Integer({ minimum: 1 }),
})
/** A `/2` session question: its steps carry their own prompts, answer kinds and assumptions. */
export const ProcessingQuestionV2 = object({
  ...questionBase,
  schema_version: Type.Literal('bench-intake-question/2'),
  fields: ProcessingFields,
  title: Type.Optional(QuestionTitle),
  reason: text,
  steps: QuestionSteps,
  figures: Type.Optional(
    Type.Array(ProcessingQuestionFigure, { minItems: 1, maxItems: QUESTION_MAX_FIGURES }),
  ),
})
/** Each question's content is sent once, in its version's shape; `questionView` normalises it. */
export const ProcessingQuestion = Type.Union([ProcessingQuestionV1, ProcessingQuestionV2])

/** Orders questions oldest first; a question retained before its time was kept comes last. */
export function oldestQuestionFirst(a: { asked_at?: string }, b: { asked_at?: string }): number {
  if (a.asked_at === b.asked_at) {
    return 0
  }
  if (!a.asked_at) {
    return 1
  }
  if (!b.asked_at) {
    return -1
  }
  return Date.parse(a.asked_at) - Date.parse(b.asked_at)
}

export const STATUS_LINE_MAX_CHARACTERS = 120
/** One status line: no line breaks, at most 120 characters. */
export const statusLine = Type.String({
  minLength: 1,
  maxLength: STATUS_LINE_MAX_CHARACTERS,
  pattern: '^[^\\r\\n\\u2028\\u2029]*$',
})
/** Why a session proposal is no longer current. */
export const ProposalStaleReason = Type.Union(
  (
    [
      'source_superseded',
      'evidence_removed',
      'answer_received',
      'operator_correction',
      'lot_regrouped',
      'subject_retired',
    ] as const
  ).map((reason) => Type.Literal(reason)),
)
/** Every refusal Start fresh makes before its first write, in the order it checks them. */
export const START_FRESH_REFUSALS = [
  'unsupported_processing_profile',
  'batch_archived',
  'subject_retired',
  'media_not_ready',
  'media_input_capacity',
  'session_not_replaceable',
  'session_reap_pending',
  'inventory_waiting',
  'identity_waiting',
  'match_waiting',
  'agent_profile_retired',
  'unsupported_processing_stage',
  'agent_settings_required',
  'retained_evidence_required',
  'unsupported_processing_input',
  'processing_input_capacity',
  'processing_channel_unconfigured',
] as const
export type StartFreshRefusal = (typeof START_FRESH_REFUSALS)[number]
/**
 * Whether Start fresh would be accepted now, from a read-only run of the command's checks. The
 * command stays authoritative and checks again; agent settings are not on a batch's event stream.
 */
export const StartFreshEligibility = Type.Union([
  object({ allowed: Type.Literal(true) }),
  object({
    allowed: Type.Literal(false),
    reason: Type.Union(START_FRESH_REFUSALS.map((code) => Type.Literal(code))),
  }),
])
export type StartFreshEligibilityDto = Static<typeof StartFreshEligibility>
export const ProcessingJob = object({
  id: Id,
  /** Null only for the batch-level Examine lead job. */
  subject_id: Type.Union([Id, Type.Null()]),
  stage: ProcessingStageV2,
  revision: Revision,
  state: ProcessingState,
  attempt_id: Id,
  input_sha256: Digest,
  attempt_number: Revision,
  qualification: Type.Union([Type.Literal('fixture_only'), Type.Literal('native_unverified')]),
  can_cancel: Type.Optional(Type.Boolean()),
  blocked_code: Type.Optional(ProcessingBlocker),
  /** Present for session profiles: the state of the job's latest session. */
  session_state: Type.Optional(SessionState),
  /** The latest session's newest status line, when it has posted one. */
  latest_status: Type.Optional(object({ text: statusLine, at: Type.String({ maxLength: 40 }) })),
  /** Session profiles only: whether Start fresh would be accepted for this job now. */
  start_fresh: Type.Optional(StartFreshEligibility),
  proposals: Type.Array(
    object({
      id: Id,
      message_id: Id,
      value: ProcessingProposal,
      /**
       * Session proposals only. Stale when a source it relies on changed; provisional while a
       * question about one of its fields is open.
       */
      currentness: Type.Optional(
        Type.Union([
          object({ state: Type.Literal('current') }),
          object({ state: Type.Literal('provisional') }),
          object({
            state: Type.Literal('stale'),
            reason: ProposalStaleReason,
          }),
        ]),
      ),
    }),
    { maxItems: 100 },
  ),
  questions: Type.Array(ProcessingQuestion, { maxItems: 100 }),
})
export const ProcessingSnapshot = object({
  runner_status: Type.Union([
    Type.Literal('unconfigured'),
    Type.Literal('fixture_only'),
    Type.Literal('native_unverified'),
  ]),
  batch_id: Id,
  capture_revision: Revision,
  jobs: Type.Array(ProcessingJob, { maxItems: 100 }),
  cursor: object({ stream_id: Id, sequence: CursorSequence }),
  /** The batch's agents are paused: its sessions start no new work until resumed. */
  paused: Type.Optional(Type.Literal(true)),
  /** Present when the batch follows `/7`'s pipeline, whose Match step replaces Inventory. */
  pipeline: Type.Optional(Type.Literal('match')),
})
export const ProcessingReceipt = object({
  batch_id: Id,
  job_ids: Type.Array(Id, { minItems: 1, maxItems: 100 }),
  attempt_ids: Type.Array(Id, { minItems: 1, maxItems: 100 }),
})
export const ProcessingAnswerReceipt = object({
  answer_id: Id,
  question_id: Id,
  attempt_id: Id,
  capture_revision: Revision,
  command_id: Id,
})
export const ProcessingActivity = object({
  jobs: Type.Array(
    object({
      batch_id: Id,
      job_id: Id,
      attempt_id: Id,
      state: ProcessingState,
      input_current: Type.Boolean(),
      occupies_lane: Type.Boolean(),
      blocked_code: Type.Optional(ProcessingBlocker),
    }),
    { maxItems: 100 },
  ),
  lane_occupied: Type.Boolean(),
  truncated: Type.Boolean(),
})
export const processingSchemas = {
  ProcessingStageV2,
  ProcessingInputV6,
  ProcessingCommandV5,
  ProcessingField,
  ProcessingReliance,
  CatalogueProposal,
  ProcessingProposalV5,
  ProcessingProposalV6,
  SessionProposal,
  ExamineIdentityV1,
  ResearchIdentityV1,
  ResearchV1,
  ImagesV1,
  StageProposal,
  StagePublishedProposal,
  RetainedSessionProposal,
  MatchNote,
  WebPageSource,
  ProcessingInputV4,
  ProcessingCommandV4,
  ProcessingEnvelopeV4,
  ProcessingInputV1,
  ProcessingInputV2,
  ProcessingInputV3,
  ProcessingCommandV1,
  ProcessingCommandV2,
  ProcessingCommandV3,
  ProcessingProposalV1,
  ProcessingProposalV2,
  ProcessingProposalV3,
  ProcessingSource,
  ProcessingSourceV3,
  ProcessingEnvelopeV1,
  ProcessingEnvelopeV2,
  ProcessingEnvelopeV3,
  ProcessingBlocker,
  ProcessingInput,
  ProcessingCommand,
  ProcessingActivity,
  ProcessingStage,
  ProcessingState,
  ProcessingStart,
  ProcessingCancellation,
  ProcessingQuestionValue,
  ProcessingAnswer,
  ProcessingAnswerV1,
  ProcessingAnswerV2,
  QuestionStepValue,
  QuestionStep,
  ProcessingQuestionSpec,
  ProcessingProposal,
  ProcessingProposalV4,
  ProcessingEnvelope,
  ProcessingQuestion,
  ProcessingQuestionV1,
  ProcessingQuestionV2,
  ProcessingAnswerSummary,
  AnswerDelivery,
  ProcessingJob,
  ProcessingSnapshot,
  ProcessingReceipt,
  ProcessingAnswerReceipt,
}
export type ProcessingStartDto = Static<typeof ProcessingStart>
export type ProcessingCancellationDto = Static<typeof ProcessingCancellation>
export type ProcessingAnswerDto = Static<typeof ProcessingAnswer>
export type ProcessingAnswerV1Dto = Static<typeof ProcessingAnswerV1>
export type ProcessingAnswerV2Dto = Static<typeof ProcessingAnswerV2>
export type ProcessingQuestionValueDto = Static<typeof ProcessingQuestionValue>
export type QuestionStepDto = Static<typeof QuestionStep>
export type QuestionStepAnswerDto = Static<typeof QuestionStepAnswer>
export type QuestionStepValueDto = Static<typeof QuestionStepValue>
export type QuestionOptionDto = Static<typeof QuestionOption>
export type ProcessingQuestionSpecDto = Static<typeof ProcessingQuestionSpec>
export type ProcessingEnvelopeDto = Static<typeof ProcessingEnvelope>
export type ProcessingSnapshotDto = Static<typeof ProcessingSnapshot>
export type ProcessingReceiptDto = Static<typeof ProcessingReceipt>
export type ProcessingAnswerReceiptDto = Static<typeof ProcessingAnswerReceipt>

export type ProcessingActivityDto = Static<typeof ProcessingActivity>

export type ProcessingInputDto = Static<typeof ProcessingInput>
export type ProcessingCommandDto = Static<typeof ProcessingCommand>
export type ProcessingProposalDto = Static<typeof ProcessingProposal>

export type ProcessingStateDto = Static<typeof ProcessingState>
export type ProcessingJobDto = Static<typeof ProcessingJob>
export type ProcessingQuestionDto = Static<typeof ProcessingQuestion>
export type ProcessingQuestionV1Dto = Static<typeof ProcessingQuestionV1>
export type ProcessingQuestionV2Dto = Static<typeof ProcessingQuestionV2>
export type QuestionFigureDto = Static<typeof QuestionFigure>
export type ProcessingQuestionFigureDto = Static<typeof ProcessingQuestionFigure>
export type ProcessingAnswerSummaryDto = Static<typeof ProcessingAnswerSummary>
export type AnswerDeliveryDto = Static<typeof AnswerDelivery>
export type AnswerEffectDto = Static<typeof AnswerEffect>

export type ProcessingInputV1Dto = Static<typeof ProcessingInputV1>
export type ProcessingInputV2Dto = Static<typeof ProcessingInputV2>
export type ProcessingInputV5Dto = Static<typeof ProcessingInputV5>
export type ProcessingCommandV1Dto = Static<typeof ProcessingCommandV1>
export type ProcessingCommandV2Dto = Static<typeof ProcessingCommandV2>
export type ProcessingProposalV1Dto = Static<typeof ProcessingProposalV1>
export type ProcessingProposalV2Dto = Static<typeof ProcessingProposalV2>
export type ProcessingSourceDto = Static<typeof ProcessingSource>
export type ProcessingEnvelopeV1Dto = Static<typeof ProcessingEnvelopeV1>
export type ProcessingEnvelopeV2Dto = Static<typeof ProcessingEnvelopeV2>
export type ProcessingBlockerDto = Static<typeof ProcessingBlocker>

export type ProcessingInputV3Dto = Static<typeof ProcessingInputV3>

export type ProcessingCommandV3Dto = Static<typeof ProcessingCommandV3>

export type ProcessingProposalV3Dto = Static<typeof ProcessingProposalV3>

export type ProcessingSourceV3Dto = Static<typeof ProcessingSourceV3>

export type ProcessingEnvelopeV3Dto = Static<typeof ProcessingEnvelopeV3>

export type ProcessingInputV4Dto = Static<typeof ProcessingInputV4>
export type ProcessingCommandV4Dto = Static<typeof ProcessingCommandV4>
export type ProcessingEnvelopeV4Dto = Static<typeof ProcessingEnvelopeV4>

export type ProcessingStageV2Dto = Static<typeof ProcessingStageV2>
export type ProcessingInputV6Dto = Static<typeof ProcessingInputV6>
export type ProcessingCommandV5Dto = Static<typeof ProcessingCommandV5>
export type ProcessingFieldDto = Static<typeof ProcessingField>
export type ProcessingRelianceDto = Static<typeof ProcessingReliance>
export type CatalogueProposalDto = Static<typeof CatalogueProposal>
export type ProcessingProposalV5Dto = Static<typeof ProcessingProposalV5>
export type ProcessingProposalV6Dto = Static<typeof ProcessingProposalV6>
export type ExamineIdentityV1Dto = Static<typeof ExamineIdentityV1>
export type ResearchIdentityV1Dto = Static<typeof ResearchIdentityV1>
export type ResearchV1Dto = Static<typeof ResearchV1>
export type ImagesV1Dto = Static<typeof ImagesV1>
export type StageProposalDto = Static<typeof StageProposal>
export type StagePublishedProposalDto = Static<typeof StagePublishedProposal>
export type RetainedSessionProposalDto = Static<typeof RetainedSessionProposal>
export type MatchNoteDto = Static<typeof MatchNote>
export type SessionProposalDto = Static<typeof SessionProposal>
