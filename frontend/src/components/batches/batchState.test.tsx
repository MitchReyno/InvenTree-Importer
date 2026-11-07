import { render, screen } from '@testing-library/react'
import type { InboxWorkflowDto } from '@invimport/contracts'
import { describe, expect, it } from 'vitest'
import { AddedBar, BatchState } from './batchState'

const approved: InboxWorkflowDto = {
  lots: 2,
  ready: 0,
  needs_review: 0,
  blocked: 0,
  approved: 2,
  open_questions: 0,
  active_jobs: 0,
  latest_round: null,
  thumbnail: null,
}

function round(state: string) {
  return {
    run_id: '40000000-0000-4000-8000-000000000004',
    round_number: '1',
    state,
    confirmed_stock: 0,
  }
}

describe('BatchState', () => {
  it('calls a batch complete only once its last round settled complete', () => {
    const { container, rerender } = render(
      <>
        <BatchState workflow={{ ...approved, latest_round: round('settled_complete') }} />
        <AddedBar workflow={{ ...approved, latest_round: round('settled_complete') }} />
      </>,
    )
    expect(screen.getByText('Complete')).toBeInTheDocument()
    expect(container.querySelector('[data-complete]')).toHaveAttribute('data-complete', 'true')

    rerender(
      <>
        <BatchState workflow={approved} />
        <AddedBar workflow={approved} />
      </>,
    )
    expect(screen.getByText('Approved')).toBeInTheDocument()
    expect(container.querySelector('[data-complete]')).toHaveAttribute('data-complete', 'false')
  })

  it('says when a round needs recovery or is still adding, whatever was approved', () => {
    const { rerender } = render(
      <BatchState workflow={{ ...approved, latest_round: round('recovery_required') }} />,
    )
    expect(screen.getByText('Needs recovery')).toBeInTheDocument()

    rerender(<BatchState workflow={{ ...approved, latest_round: round('settled_incomplete') }} />)
    expect(screen.getByText('Needs recovery')).toBeInTheDocument()

    rerender(<BatchState workflow={{ ...approved, latest_round: round('running') }} />)
    expect(screen.getByText('Adding to InvenTree')).toBeInTheDocument()
  })
})
