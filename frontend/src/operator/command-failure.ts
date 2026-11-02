import { IntakeRequestError } from '@invimport/contracts/client'

/**
 * conflict: another client saved first; local input stays until explicit reload.
 * rejected: the server definitely refused; a new attempt may use a new key.
 * uncertain: the outcome is unknown; retry must reuse the exact payload and key.
 */
export type CommandFailureKind = 'conflict' | 'rejected' | 'uncertain'

export interface CommandFailure {
  kind: CommandFailureKind
  code: string | null
}

export function classifyFailure(error: unknown): CommandFailure {
  if (error instanceof IntakeRequestError) {
    if (error.status === 412 || error.code === 'revision_conflict') {
      return { kind: 'conflict', code: error.code }
    }
    return { kind: 'rejected', code: error.code }
  }
  return { kind: 'uncertain', code: null }
}

const REJECTION_MESSAGES: Record<string, string> = {
  lot_retired: 'One of these lots was split or merged. Reload to see its successor lots.',
  lot_already_approved:
    'An approved lot cannot be restructured. Its original run keeps its identity.',
  issue_not_found: 'This warning no longer applies. Reload to see current issues.',
  stale_issue: 'This warning changed since it was shown. Reload before dismissing it.',
  issue_not_dismissible: 'Blocking issues cannot be dismissed; fix the underlying fact.',
  subject_not_found: 'A selected lot or Part proposal no longer exists in this batch.',
  group_not_found: 'That evidence group no longer exists in this batch.',
  batch_archived: 'Resume this batch before changing it.',
}

export function failureMessage(failure: CommandFailure): string {
  if (failure.kind === 'conflict') {
    return 'Another client saved first. Your input is kept here and was not applied. Load the current saved values, then reapply deliberately.'
  }
  if (failure.kind === 'uncertain') {
    return 'The outcome is not confirmed. Retry sends the exact same request and key, so it cannot apply twice.'
  }
  return (
    (failure.code && REJECTION_MESSAGES[failure.code]) ??
    'The server did not accept this change. Your input is kept.'
  )
}
