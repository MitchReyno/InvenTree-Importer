import { canonicalRecord } from '@invimport/contracts/json'
import type {
  MatchCandidateDto,
  MatchContributionHitDto,
  MatchDecisionDto,
  MatchIdentityDto,
  MatchKeyDto,
  MatchOutcomeDto,
  MatchPartCandidateDto,
  MatchQuestionKindDto,
  MatchQuestionNoteDto,
} from '@invimport/contracts'
import { RESEARCH_GAP_FIELDS } from '@invimport/contracts'
import { searchable } from './keys.ts'

/** What one settled search found, retained with its request. */
export interface MatchResult {
  schema_version: 'bench-intake-match-result/1'
  lot_id: string
  generation: string
  /** The target context the reads were made in; a decision checks it is still current. */
  target_context_id: string
  /**
   * `remote` searched InvenTree and other batches; `local_only` had no strong key, so only the
   * import reference was looked up; `unavailable` couldn't read InvenTree.
   */
  searched: 'remote' | 'local_only' | 'unavailable'
  keys: MatchKeyDto[]
  candidates: MatchCandidateDto[]
  contribution?: MatchContributionHitDto
  verdict: 'none' | 'exact' | 'possible' | 'duplicate'
  notes: MatchQuestionNoteDto[]
}

/** The verdict of what was found: a duplicate first, then an exact candidate, then any. */
export function verdictOf(
  candidates: readonly MatchCandidateDto[],
  contribution: MatchContributionHitDto | undefined,
): MatchResult['verdict'] {
  if (
    contribution ||
    candidates.some((candidate) => candidate.kind === 'part' && candidate.verdict === 'duplicate')
  ) {
    return 'duplicate'
  }
  if (candidates.some((candidate) => candidate.kind === 'part' && candidate.verdict === 'exact')) {
    return 'exact'
  }
  return candidates.length ? 'possible' : 'none'
}

/**
 * A Part as a decision covers it: its stock with the lot's batch code, whether it has an image and
 * which fillable fields it lacks, since those set the options offered and the modes they set.
 */
function partCovered(candidate: MatchPartCandidateDto) {
  const stock = candidate.stock.map((item) => item.pk).sort()
  const gaps = candidate.missing
    .flatMap((missing) => {
      if (missing.kind === 'parameter') {
        return [`parameter:${missing.template}`]
      }
      return missing.kind === 'datasheet' || missing.kind === 'part_image' ? [missing.kind] : []
    })
    .sort()
  return `part:${candidate.part.pk}:${stock.join(',')}:${candidate.part.has_image}:${gaps.join(',')}`
}

/**
 * The candidates a decision covers, as canonical text: each Part with the stock it showed, each
 * competing lot and any contribution hit, with what each Part lacks. Two results that cover the same are equivalent, so a
 * repeat search keeps the decision and the proposals pinned to it.
 */
export function coveredOf(result: Pick<MatchResult, 'candidates' | 'contribution'>) {
  const items = result.candidates.map((candidate) =>
    candidate.kind === 'part' ? partCovered(candidate) : `lot:${candidate.lot_id}`,
  )
  if (result.contribution) {
    items.push('contribution')
  }
  return canonicalRecord(items.sort())
}

/** The stage modes a decision sets, given the Part it targets. */
export function decisionModes(
  decision: MatchDecisionDto,
  candidate: MatchPartCandidateDto | undefined,
): Pick<MatchOutcomeDto, 'research' | 'images'> {
  if (decision === 'already_imported') {
    return {
      research: { stage: 'research', mode: 'skipped' },
      images: { stage: 'images', mode: 'skipped' },
    }
  }
  if (decision === 'new_part' || !candidate) {
    return {
      research: { stage: 'research', mode: 'full' },
      images: { stage: 'images', mode: 'full' },
    }
  }
  const images = {
    stage: 'images' as const,
    mode: 'stock' as const,
    part_image: !candidate.part.has_image,
  }
  if (decision === 'add_stock') {
    return { research: { stage: 'research', mode: 'skipped' }, images }
  }
  // Fill what's missing researches only the datasheet and key parameters InvenTree lacks; the
  // Part image is Images'.
  const fields = RESEARCH_GAP_FIELDS.filter((field) =>
    candidate.missing.some((missing) =>
      field === 'datasheet' ? missing.kind === 'datasheet' : missing.kind === 'parameter',
    ),
  )
  return {
    research: fields.length
      ? { stage: 'research', mode: 'gaps', fields: [...fields] }
      : { stage: 'research', mode: 'skipped' },
    images,
  }
}

export function outcomeRecord(
  lotId: string,
  revision: bigint,
  basis: MatchOutcomeDto['basis'],
  modes: Pick<MatchOutcomeDto, 'research' | 'images'>,
): MatchOutcomeDto {
  return {
    schema_version: 'bench-intake-match-outcome/1',
    lot_id: lotId,
    revision: revision.toString(),
    basis,
    ...modes,
  }
}

/** What the lot had when its search settled. */
export interface MatchStanding {
  /** The outcome in force; none while a question is open or after one was left held. */
  outcome?: { outcome: MatchOutcomeDto; covered: string; targetPartPk: string | null }
  /**
   * The latest outcome recorded, in force or not: a question opened after an add stock decision
   * leaves that decision here, so a later clear search still can't drop its target.
   */
  recorded?: { outcome: MatchOutcomeDto }
  /** The identity the outcome in force was recorded under. */
  outcomeIdentity?: MatchIdentityDto
  openQuestion?: { kind: MatchQuestionKindDto; covered: string }
  identity: MatchIdentityDto
}

/** What settling a search does to the lot. */
export type MatchStep =
  | { kind: 'unavailable' }
  | { kind: 'keep' }
  | { kind: 'keep_question' }
  | { kind: 'question'; questionKind: MatchQuestionKindDto }
  | { kind: 'clear' }

/** Whether the lot's outcome sends stock to an existing Part. */
function targetsExistingPart(standing: MatchStanding) {
  const basis = (standing.outcome ?? standing.recorded)?.outcome.basis
  return (
    basis?.kind === 'decision' && (basis.decision === 'add_stock' || basis.decision === 'fill_gaps')
  )
}

/**
 * The rule a settled search follows. A hit on the lot's own approved contribution or a candidate
 * asks the operator, unless the decision or the open question already covers exactly the same;
 * no candidates is a clear verdict, unless it would drop an existing-Part target, or the
 * operator's own identity had nothing to search with.
 */
export function nextStep(result: MatchResult, standing: MatchStanding): MatchStep {
  if (result.searched === 'unavailable') {
    return { kind: 'unavailable' }
  }
  const covered = coveredOf(result)

  const asking = (questionKind: MatchQuestionKindDto): MatchStep => {
    if (standing.openQuestion?.kind === questionKind && standing.openQuestion.covered === covered) {
      return { kind: 'keep_question' }
    }
    return { kind: 'question', questionKind }
  }

  if (result.contribution) {
    if (
      standing.outcome?.outcome.basis.kind === 'decision' &&
      standing.outcome.outcome.basis.decision === 'already_imported' &&
      standing.outcome.covered === covered
    ) {
      return { kind: 'keep' }
    }
    return asking('contribution')
  }
  if (result.candidates.length) {
    if (
      standing.outcome?.outcome.basis.kind === 'decision' &&
      standing.outcome.covered === covered
    ) {
      return { kind: 'keep' }
    }
    return asking('candidates')
  }
  if (targetsExistingPart(standing)) {
    return asking('target_lost')
  }
  const decided = standing.outcome?.outcome.basis.kind === 'decision'
  // An operator's lot with no strong key is asked about rather than identified by Research,
  // even after an earlier clear search on keys since removed.
  if (standing.identity.kind === 'operator' && !searchable(result.keys) && !decided) {
    return asking('unresolved')
  }
  if (decided) {
    return { kind: 'keep' }
  }
  // A clear verdict on another identity is a new one, so work sealed for the old identity stops.
  if (
    standing.outcome &&
    canonicalRecord(standing.outcomeIdentity ?? null) === canonicalRecord(standing.identity)
  ) {
    return { kind: 'keep' }
  }
  return { kind: 'clear' }
}
