import type { PoolClient } from 'pg'
import type { MatchBindingDto, SealedMatchDto } from '@invimport/contracts'
import type { MatchStage } from '#/processing/match-outcome.ts'
import { currentBinding, currentOutcome, readMatch, sameBinding, searchPending } from './state.ts'

/** Why Match holds a lot's stage, or that it allows it. */
export type MatchGate =
  | {
      allowed: true
      outcome?: Awaited<ReturnType<typeof currentOutcome>>
      /** The lot's Capture binding, which Match's state was settled for. */
      binding?: MatchBindingDto
    }
  | {
      allowed: false
      reason: 'searching' | 'held' | 'skipped' | 'outcome_changed' | 'binding_changed'
    }

/**
 * Whether Match lets a lot's stage start or resume now: no search is pending, the stage isn't
 * held, Capture still binds the lot as Match last saw it, the lot has an outcome that runs the
 * stage, and, for sealed work, it was sealed under that outcome and binding. A changed binding
 * waits for the search the Match sweep requests for it. A lot Match has never seen is allowed:
 * its stages were queued without Match. A read only; claim, resume, Start and replacement each
 * check it in their own transaction.
 */
export async function matchGate(
  client: PoolClient,
  lotId: string,
  stage: MatchStage,
  sealed?: SealedMatchDto,
): Promise<MatchGate> {
  const row = await readMatch(client, lotId)
  if (!row) {
    return { allowed: true }
  }
  if (searchPending(row)) {
    return { allowed: false, reason: 'searching' }
  }
  if (row.waits.includes(stage) || row.state === 'question' || row.state === 'held') {
    return { allowed: false, reason: 'held' }
  }
  const binding = await currentBinding(client, lotId)
  if (!sameBinding(binding, row.binding)) {
    return { allowed: false, reason: 'binding_changed' }
  }
  const outcome = await currentOutcome(client, row)
  if (!outcome) {
    return { allowed: false, reason: 'held' }
  }
  if (outcome.outcome[stage].mode === 'skipped') {
    return { allowed: false, reason: 'skipped' }
  }
  if (sealed && sealed.outcome?.revision !== outcome.outcome.revision) {
    return { allowed: false, reason: 'outcome_changed' }
  }
  if (sealed && !sameBinding(sealed.binding, binding)) {
    return { allowed: false, reason: 'binding_changed' }
  }
  return { allowed: true, outcome, binding }
}
