import type { PoolClient } from 'pg'
import type { SealedMatchDto } from '@invimport/contracts'
import type { MatchStage } from '../match-outcome.ts'
import { currentOutcome, readMatch, searchPending } from './state.ts'

/** Why Match holds a lot's stage, or that it allows it. */
export type MatchGate =
  | { allowed: true; outcome?: Awaited<ReturnType<typeof currentOutcome>> }
  | { allowed: false; reason: 'searching' | 'held' | 'skipped' | 'outcome_changed' }

/**
 * Whether Match lets a lot's stage start or resume now: no search is pending, the stage isn't
 * held, the lot has an outcome that runs the stage, and, for sealed work, it was sealed under
 * that outcome. A lot Match has never seen is allowed: its stages were queued without Match.
 * A read only; claim, resume, Start and replacement each check it in their own transaction.
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
  return { allowed: true, outcome }
}
