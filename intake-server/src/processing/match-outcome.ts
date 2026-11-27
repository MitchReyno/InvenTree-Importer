import type { MatchBindingDto, MatchOutcomeDto, SealedMatchDto } from '@invimport/contracts'
import { fail, type Stage } from './model.ts'

/** The lot stages a `/7` input is sealed for; Match never queues Inventory. */
export type MatchStage = 'research' | 'images'

/** A `/7` lot job's stage, which is never Inventory. */
export function lotStageOf(stage: Stage | 'examine'): MatchStage {
  if (stage !== 'research' && stage !== 'images') {
    return fail('unsupported_processing_stage', 422)
  }
  return stage
}

/**
 * What a `/7` lot attempt seals of its Match outcome: the outcome's revision and basis, and the
 * mode it sets for the stage. Match seals the outcome it recorded; with none, as for a lot Match
 * has never seen (tests and retained work), the stage runs in full mode as after a clear search.
 * An outcome that skips the stage queues nothing for it. With an outcome, the attempt also seals
 * the lot's Capture binding, so a later relink or draft change holds it.
 */
export function sealedMatchFor(outcome: null, stage: MatchStage): SealedMatchDto
export function sealedMatchFor(
  outcome: MatchOutcomeDto,
  stage: MatchStage,
  binding: MatchBindingDto,
): SealedMatchDto
export function sealedMatchFor(
  outcome: MatchOutcomeDto | null,
  stage: MatchStage,
  binding?: MatchBindingDto,
): SealedMatchDto {
  if (outcome === null) {
    return { outcome: null, mode: { stage, mode: 'full' } }
  }
  const mode = stage === 'research' ? outcome.research : outcome.images
  if (mode.mode === 'skipped') {
    return fail('unsupported_processing_stage', 422)
  }
  return {
    outcome: { revision: outcome.revision, basis: outcome.basis },
    mode,
    ...(binding ? { binding } : {}),
  }
}
