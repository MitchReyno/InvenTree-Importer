import type { OperatorIssueDto } from '@invimport/contracts'
import { batchHref, type ProcessingStep } from '../navigation/batch-route'

export type ProblemAction =
  | { kind: 'edit_values'; label: string }
  | { kind: 'edit_part'; label: string }
  | { kind: 'link'; label: string; href: string }

type Context = {
  batchId: string
  lotId: string
  partId: string | null
  /** The lot's open Processing question, if any. */
  openQuestion: { id: string; step: ProcessingStep } | null
}

const LOCATION_CODES = new Set([
  'location_required',
  'location_conflict',
  'location_draft_parent_invalid',
  'location_groups_unavailable',
])

/** Problems a human answer can settle, so the lot's open question is offered first. */
const ANSWERABLE = new Set(['part_choice_required', 'quantity_required', ...LOCATION_CODES])

/** The fix for each problem, on the screen that owns it. */
export function problemActions(issue: OperatorIssueDto, context: Context): ProblemAction[] {
  const { batchId } = context
  const actions: ProblemAction[] = []
  if (context.openQuestion && ANSWERABLE.has(issue.code)) {
    actions.push({
      kind: 'link',
      label: 'Answer the open question',
      href: batchHref(batchId, {
        tab: 'processing',
        step: context.openQuestion.step,
        questionId: context.openQuestion.id,
      }),
    })
  }

  if (issue.code === 'part_choice_required') {
    if (context.partId) {
      actions.push({ kind: 'edit_part', label: 'Choose the Part' })
    }
    actions.push({
      kind: 'link',
      label: 'Decide in Records',
      href: batchHref(batchId, { tab: 'review', view: 'records' }),
    })
  } else if (issue.code === 'quantity_required') {
    actions.push({ kind: 'edit_values', label: 'Set the quantity' })
  } else if (LOCATION_CODES.has(issue.code)) {
    actions.push({ kind: 'edit_values', label: 'Set the location' })
    if (issue.code !== 'location_required') {
      actions.push({
        kind: 'link',
        label: 'Check evidence groups in Capture',
        href: batchHref(batchId, { tab: 'capture' }),
      })
    }
  } else if (issue.code === 'no_supporting_evidence') {
    actions.push({
      kind: 'link',
      label: 'Link evidence on the Map',
      href: batchHref(batchId, { tab: 'review', view: 'map' }),
    })
    actions.push({
      kind: 'link',
      label: 'Add evidence in Capture',
      href: batchHref(batchId, { tab: 'capture' }),
    })
  } else if (issue.code === 'possible_duplicate_part') {
    if (context.partId) {
      actions.push({ kind: 'edit_part', label: 'Compare with the existing Part' })
    }
    actions.push({
      kind: 'link',
      label: 'Decide in Records',
      href: batchHref(batchId, { tab: 'review', view: 'records' }),
    })
  }

  return actions
}
