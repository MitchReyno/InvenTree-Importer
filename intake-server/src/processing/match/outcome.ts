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
    // The stock status is part of what the question says, when the operator may see it.
    items.push(
      result.contribution.readable ? `contribution:${result.contribution.stock}` : 'contribution',
    )
  }
  return canonicalRecord(items.sort())
}

/**
 * What an open question shows, as canonical text: what a decision covers, and each candidate's
 * verdict, matched keys and gaps, so a repeat search that changes any of them asks afresh.
 */
export function questionCoveredOf(result: Pick<MatchResult, 'candidates' | 'contribution'>) {
  // Each candidate as the question quotes it: its verdict, what matched and every gap.
  const quoted = result.candidates.map((candidate) =>
    canonicalRecord(
      candidate.kind === 'part'
        ? {
            pk: candidate.part.pk,
            verdict: candidate.verdict,
            matched_by: candidate.matched_by,
            missing: candidate.missing,
            parameters_known: candidate.parameters_known,
          }
        : { lot_id: candidate.lot_id, matched_by: candidate.matched_by },
    ),
  )
  return canonicalRecord([coveredOf(result), ...quoted.sort()])
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
  /** The open question, with what it shows (`questionCoveredOf`). */
  openQuestion?: { kind: MatchQuestionKindDto; covered: string }
  identity: MatchIdentityDto
  /**
   * The InvenTree Part the lot is bound to in Capture now, or null for a draft or none; omitted
   * when not known. A binding the outcome didn't set means the operator changed the target.
   */
  captureTarget?: string | null
}

/**
 * Whether the lot's Capture binding must agree with the outcome: a decision binds it (to a Part,
 * or to a draft for a new one) and a clear search leaves it on a draft; a lot left out doesn't.
 */
export function checksTarget(outcome: MatchOutcomeDto) {
  return !(outcome.basis.kind === 'decision' && outcome.basis.decision === 'already_imported')
}

/** The InvenTree Part an outcome binds the lot to: add stock and fill what's missing name one. */
export function outcomeTarget(
  outcome: { outcome: MatchOutcomeDto; targetPartPk: string | null } | undefined,
) {
  const basis = outcome?.outcome.basis
  const existing =
    basis?.kind === 'decision' && (basis.decision === 'add_stock' || basis.decision === 'fill_gaps')
  return existing ? outcome!.targetPartPk : null
}

/** What settling a search does to the lot. */
export type MatchStep =
  | { kind: 'unavailable' }
  | { kind: 'keep' }
  | { kind: 'keep_question' }
  | { kind: 'question'; questionKind: MatchQuestionKindDto }
  | { kind: 'clear' }
  /** The outcome in force stands, recorded again under the lot's new identity. */
  | { kind: 'renew' }

/** Whether the outcome in force was recorded under the lot's current identity. */
function sameIdentity(standing: MatchStanding) {
  return canonicalRecord(standing.outcomeIdentity ?? null) === canonicalRecord(standing.identity)
}

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

  const shown = questionCoveredOf(result)

  const asking = (questionKind: MatchQuestionKindDto): MatchStep => {
    if (standing.openQuestion?.kind === questionKind && standing.openQuestion.covered === shown) {
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
  // Capture binds the lot to another Part than its outcome did, or to an existing Part with none
  // decided yet: it is decided afresh rather than researched as found.
  if (
    standing.captureTarget !== undefined &&
    standing.captureTarget !== outcomeTarget(standing.outcome) &&
    (!standing.outcome || checksTarget(standing.outcome.outcome))
  ) {
    return asking(result.candidates.length ? 'candidates' : 'target_lost')
  }
  if (result.candidates.length) {
    if (
      standing.outcome?.outcome.basis.kind === 'decision' &&
      standing.outcome.covered === covered
    ) {
      return sameIdentity(standing) ? { kind: 'keep' } : { kind: 'renew' }
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
  if (!standing.outcome) {
    return { kind: 'clear' }
  }
  // The outcome stands, but under a new identity it is recorded again, so work sealed for the
  // old identity (an operator's has no proposal pin to tell them apart) stops.
  if (!sameIdentity(standing)) {
    return { kind: 'renew' }
  }
  return { kind: 'keep' }
}
