import { render, screen } from '@testing-library/react'
import type { InboxWorkflowDto } from '@invimport/contracts'
import { describe, expect, it } from 'vitest'
import { AddedBar, BatchState, evidenceLine, stageLine } from './batchState'

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

describe('BatchThumbnail', () => {
  it('says whether a batch has no photos yet or its preview failed', async () => {
    const { BatchThumbnail } = await import('./BatchThumbnail')
    const { rerender } = render(<BatchThumbnail batchId="b" thumbnail={null} />)
    expect(screen.getByRole('img', { name: 'No photos yet' })).toBeInTheDocument()

    rerender(<BatchThumbnail batchId="b" thumbnail={{ preview_id: 'p', label: 'Packet' }} />)
    const image = screen.getByRole('img', { name: 'Packet' })
    image.dispatchEvent(new Event('error'))
    expect(await screen.findByRole('img', { name: 'Preview unavailable' })).toBeInTheDocument()
  })
})

describe('BatchState before any lot exists', () => {
  it('shows work or questions on a batch with no lots ahead of Draft', () => {
    const empty = { ...approved, lots: 0, approved: 0 }
    const { rerender } = render(<BatchState workflow={{ ...empty, active_jobs: 1 }} />)
    expect(screen.getByText('Processing')).toBeInTheDocument()

    rerender(<BatchState workflow={{ ...empty, open_questions: 2 }} />)
    expect(screen.getByText('2 need you')).toBeInTheDocument()

    rerender(<BatchState workflow={empty} />)
    expect(screen.getByText('Draft')).toBeInTheDocument()
  })
})

describe('stageLine', () => {
  const idle = { jobs: 0, ready: 0, running: 0 }

  const steps = (examine = idle, research = idle) => ({
    examine,
    research,
    images: idle,
    inventory: idle,
  })

  it('says lots are being sorted while Examine runs, with how many it has found', () => {
    expect(
      stageLine({ ...approved, lots: 5, steps: steps({ jobs: 1, ready: 0, running: 1 }) }),
    ).toBe('Sorting into lots · 5 found so far')
    expect(
      stageLine({ ...approved, lots: 0, steps: steps({ jobs: 1, ready: 0, running: 1 }) }),
    ).toBe('Sorting into lots')
  })

  it('names a later running step with how many of its jobs are done', () => {
    expect(
      stageLine({
        ...approved,
        steps: steps({ jobs: 1, ready: 1, running: 0 }, { jobs: 5, ready: 3, running: 2 }),
      }),
    ).toBe('Research · 3 of 5')
  })

  it('says nothing when no step runs or the read has no step counts', () => {
    expect(stageLine({ ...approved, steps: steps({ jobs: 1, ready: 1, running: 0 }) })).toBeNull()
    expect(stageLine(approved)).toBeNull()
  })
})

describe('evidenceLine', () => {
  it('counts photos, documents and other files, leaving out what there is none of', () => {
    expect(evidenceLine({ ...approved, evidence: { photos: 4, documents: 1, other: 0 } })).toBe(
      '4 photos · 1 document',
    )
    expect(evidenceLine({ ...approved, evidence: { photos: 1, documents: 0, other: 2 } })).toBe(
      '1 photo · 2 other files',
    )
    expect(
      evidenceLine({ ...approved, evidence: { photos: 0, documents: 0, other: 0 } }),
    ).toBeNull()
    expect(evidenceLine(approved)).toBeNull()
  })
})
