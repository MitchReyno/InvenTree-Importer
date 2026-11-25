import type {
  BriefStageDto,
  ProcessingInputV7Dto,
  StageModeDto,
  StageProposalDto,
  StagePublishedProposalDto,
  ValidationIssue,
} from '@invimport/contracts'
import { ToolRefusal } from './refusal.ts'

type StageKind = StageProposalDto['schema_version']

/** The kinds each `/7` stage publishes; Images publishes its recipes with its own tool. */
const STAGE_KINDS: Record<BriefStageDto, readonly StageKind[]> = {
  examine: ['examine-identity/1'],
  research: ['research-identity/1', 'research/1'],
  images: ['images/1'],
}

/** Every kind's value fields: what a stage proposes, as opposed to what each output carries. */
const VALUE_FIELDS: Record<StageKind, readonly string[]> = {
  'examine-identity/1': [
    'markings',
    'candidates',
    'maker',
    'packaging',
    'date_code',
    'condition',
    'nos_signals',
    'nsn',
    'quantity',
    'match_notes',
  ],
  'research-identity/1': [
    'resolution',
    'mpn',
    'manufacturer',
    'aliases',
    'cross_references',
    'tried',
    'match_notes',
  ],
  'research/1': [
    'category',
    'name',
    'type',
    'manufacturer',
    'description',
    'parameters',
    'datasheet',
    'notes',
    'conflicts',
    'config_gaps',
    'match_notes',
  ],
  'images/1': ['images'],
}

/** `research/1`'s Part values, which gaps mode limits to the fields Match named. */
const PART_VALUE_FIELDS = [
  'category',
  'name',
  'type',
  'manufacturer',
  'description',
  'parameters',
  'datasheet',
] as const

const STAGE_NAMES: Record<BriefStageDto, string> = {
  examine: 'Examine',
  research: 'Research',
  images: 'Images',
}

/** At most this many issues reach the agent, as for schema validation. */
const MAX_ISSUES = 8

function presentFields(proposal: StagePublishedProposalDto, fields: readonly string[]) {
  return fields.filter((field) => Object.hasOwn(proposal, field))
}

function fieldIssues(fields: readonly string[], reason: string): ValidationIssue[] {
  return fields.slice(0, MAX_ISSUES).map((field) => ({
    path: `/proposal/${field}`,
    rule: 'not_allowed',
    reason,
  }))
}

/** A proposal of a kind its stage doesn't publish, naming every value field it carries. */
function wrongKind(stage: BriefStageDto, proposal: StagePublishedProposalDto) {
  const name = STAGE_NAMES[stage]
  const fields = presentFields(proposal, VALUE_FIELDS[proposal.schema_version])
  const allowed = STAGE_KINDS[stage].join(' or ')
  const kindIssue = {
    path: '/proposal/schema_version',
    rule: 'not_allowed',
    reason: `${name} publishes ${allowed}.`,
  }
  return new ToolRefusal(
    'validation_failed',
    `${name} may not publish ${proposal.schema_version} or propose ${fields.join(', ')}. Publish ${allowed} instead.`,
    [kindIssue, ...fieldIssues(fields, `${name} may not propose this field.`)].slice(0, MAX_ISSUES),
  )
}

/** Research's mode limits what `research/1` may carry: nothing in identify mode, gaps only. */
function researchModeRefusal(mode: StageModeDto, proposal: StagePublishedProposalDto) {
  if (proposal.schema_version !== 'research/1') {
    return null
  }
  if (mode.mode === 'identify') {
    return new ToolRefusal(
      'validation_failed',
      'In identify mode Research publishes research-identity/1 only; research/1 waits for Match.',
      [
        {
          path: '/proposal/schema_version',
          rule: 'not_allowed',
          reason: 'Publish research-identity/1 in identify mode.',
        },
      ],
    )
  }
  if (mode.mode !== 'gaps') {
    return null
  }
  const gaps: readonly string[] = mode.fields
  const outside = presentFields(proposal, PART_VALUE_FIELDS).filter(
    (field) => !gaps.includes(field),
  )
  if (!outside.length) {
    return null
  }
  return new ToolRefusal(
    'validation_failed',
    `In gaps mode Research fills only ${mode.fields.join(' and ')}; remove ${outside.join(', ')}.`,
    fieldIssues(outside, `Gaps mode fills only ${mode.fields.join(' and ')}.`),
  )
}

/**
 * Refuses a `/7` proposal of a kind its stage doesn't publish, or with fields its stage or mode
 * may not propose, as a correctable result naming them. Null when the proposal may be published.
 */
export function stageOutputRefusal(
  manifest: ProcessingInputV7Dto,
  proposal: StagePublishedProposalDto,
): ToolRefusal | null {
  const stage = manifest.stage
  // A `/7` input is never sealed for Inventory; its type is wider than its schema.
  if (stage === 'inventory') {
    return new ToolRefusal('tool_not_allowed', 'This session publishes no stage output.')
  }
  if (!STAGE_KINDS[stage].includes(proposal.schema_version)) {
    return wrongKind(stage, proposal)
  }
  if (stage === 'research' && 'match' in manifest) {
    return researchModeRefusal(manifest.match.mode, proposal)
  }
  return null
}
