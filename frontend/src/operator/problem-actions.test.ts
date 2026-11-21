import { describe, expect, it } from 'vitest'
import type { OperatorIssueDto } from '@invimport/contracts'
import { problemActions } from './problem-actions'

const b = 'b0000000-0000-4000-8000-000000000001'
const lot = 'l0000000-0000-4000-8000-000000000002'

function issue(code: string, severity: 'blocking' | 'warning' = 'blocking'): OperatorIssueDto {
  return {
    code,
    severity,
    message: code,
    subject_id: lot,
    lot_id: lot,
    run_id: null,
    dependency_digest: null,
    disposition: null,
  } as OperatorIssueDto
}

const context = { batchId: b, lotId: lot, partId: 'p1', openQuestion: null }

describe('problemActions', () => {
  it('routes a missing Part to the Part choice and to Records', () => {
    expect(problemActions(issue('part_choice_required'), context)).toEqual([
      { kind: 'edit_part', label: 'Choose the Part' },
      { kind: 'link', label: 'Decide in Records', href: `#${b}/review/records` },
    ])
  })

  it('routes quantity and location problems to an edit on the lot itself', () => {
    expect(problemActions(issue('quantity_required'), context)).toEqual([
      { kind: 'edit_values', label: 'Set the quantity' },
    ])
    expect(problemActions(issue('location_required'), context)).toEqual([
      { kind: 'edit_values', label: 'Set the location' },
    ])
    expect(problemActions(issue('location_conflict'), context)).toEqual([
      { kind: 'edit_values', label: 'Set the location' },
      { kind: 'link', label: 'Check evidence groups in Capture', href: `#${b}/capture` },
    ])
  })

  it('offers the lot’s open question first when one exists', () => {
    const actions = problemActions(issue('part_choice_required'), {
      ...context,
      openQuestion: { id: 'q1', step: 'examine' },
    })

    expect(actions[0]).toEqual({
      kind: 'link',
      label: 'Answer the open question',
      href: `#${b}/processing/examine/q1`,
    })
  })

  it('routes the warnings the server raises to the screens that own them', () => {
    expect(problemActions(issue('no_supporting_evidence', 'warning'), context)).toEqual([
      { kind: 'link', label: 'Link evidence on the Map', href: `#${b}/review/map` },
      { kind: 'link', label: 'Add evidence in Capture', href: `#${b}/capture` },
    ])
    expect(problemActions(issue('possible_duplicate_part', 'warning'), context)).toEqual([
      { kind: 'edit_part', label: 'Compare with the existing Part' },
      { kind: 'link', label: 'Decide in Records', href: `#${b}/review/records` },
    ])
  })

  it('offers nothing for a problem it cannot route', () => {
    expect(problemActions(issue('source_history_unsettled'), context)).toEqual([])
  })
})
