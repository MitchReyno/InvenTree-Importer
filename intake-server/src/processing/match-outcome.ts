import type { MatchOutcomeDto, SealedMatchDto } from '@invimport/contracts'
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
 * mode it sets for the stage. With no outcome recorded, the stage runs in full mode as after a
 * clear search; until the Match step records outcomes, every queueing path seals that. An
 * outcome that skips the stage queues nothing for it.
 */
export function sealedMatchFor(outcome: MatchOutcomeDto | null, stage: MatchStage): SealedMatchDto {
  if (outcome === null) {
    return { outcome: null, mode: { stage, mode: 'full' } }
  }
  const mode = stage === 'research' ? outcome.research : outcome.images
  if (mode.mode === 'skipped') {
    return fail('unsupported_processing_stage', 422)
  }
  return { outcome: { revision: outcome.revision, basis: outcome.basis }, mode }
}
