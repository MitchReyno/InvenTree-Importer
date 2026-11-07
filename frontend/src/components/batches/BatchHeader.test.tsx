import { render, screen, within } from '@testing-library/react'
import type { BatchAttentionDto, CaptureSnapshotDto } from '@invimport/contracts'
import { describe, expect, it, vi } from 'vitest'
import { BatchHeader } from './BatchHeader'

const noSteps = {
  examine: { questions: 0, failed: 0, jobs: 0, ready: 0, running: 0 },
  research: { questions: 0, failed: 0, jobs: 0, ready: 0, running: 0 },
  images: { questions: 0, failed: 0, jobs: 0, ready: 0, running: 0 },
  inventory: { questions: 0, failed: 0, jobs: 0, ready: 0, running: 0 },
}

const batchId = 'b0000000-0000-4000-8000-000000000001'
const batch = {
  id: batchId,
  title: 'Mouser 3381-22 + bench bag',
  archived: false,
  lots: [],
  parts: [],
} as unknown as CaptureSnapshotDto

const attention: BatchAttentionDto = {
  batch_id: batchId,
  revision: '3',
  processing: { questions: 3, failed: 0, running: 0, steps: noSteps },
  review: { to_check: 8, changed_after_review: 0, to_decide: 3, records: 46 },
  changes: { ready: 6, failed: 1, uncertain: 1, runs: 1 },
  items: [],
  items_truncated: false,
}

function header(
  route: Parameters<typeof BatchHeader>[0]['route'],
  evidence?: { files: number; unused: number },
) {
  return render(
    <BatchHeader
      batch={batch}
      route={route}
      attention={attention}
      evidence={evidence}
      activeLotCount={8}
      retiredLotCount={0}
      busy={false}
      onArchive={vi.fn()}
    />,
  )
}

describe('BatchHeader', () => {
  it('flags failed attempts on Processing and on their step', () => {
    render(
      <BatchHeader
        batch={batch}
        route={{ tab: 'processing', step: 'overview' }}
        attention={{
          ...attention,
          processing: {
            questions: 3,
            failed: 1,
            running: 0,
            steps: {
              ...noSteps,
              research: { questions: 0, failed: 1, jobs: 0, ready: 0, running: 0 },
            },
          },
          // Step badges come from exact counts, not from the possibly truncated items.
          items: [],
        }}
        activeLotCount={8}
        retiredLotCount={0}
        busy={false}
        onArchive={vi.fn()}
      />,
    )
    const tabs = within(screen.getByRole('navigation', { name: 'Batch' }))
    const steps = within(screen.getByRole('navigation', { name: 'Processing steps' }))

    expect(
      tabs.getByRole('link', { name: 'Processing, 3 questions · 1 failed' }),
    ).toBeInTheDocument()
    expect(steps.getByRole('link', { name: 'Research, 1 failed' })).toBeInTheDocument()
  })

  it('marks running work and the progress of each step from the attention read', () => {
    render(
      <BatchHeader
        batch={batch}
        route={{ tab: 'processing', step: 'research' }}
        attention={{
          ...attention,
          processing: {
            questions: 0,
            failed: 0,
            running: 2,
            steps: {
              ...noSteps,
              examine: { questions: 0, failed: 0, jobs: 3, ready: 3, running: 0 },
              research: { questions: 0, failed: 0, jobs: 12, ready: 7, running: 2 },
            },
          },
          items: [],
        }}
        activeLotCount={8}
        retiredLotCount={0}
        busy={false}
        onArchive={vi.fn()}
      />,
    )
    const steps = within(screen.getByRole('navigation', { name: 'Processing steps' }))

    expect(steps.getByRole('link', { name: 'Examine, done' })).toBeInTheDocument()
    expect(steps.getByRole('link', { name: 'Research, 7 of 12 ready' })).toHaveTextContent(
      '7 of 12',
    )
    expect(steps.getByRole('link', { name: 'Images' })).toBeInTheDocument()
  })

  it('says when the attention read is unavailable instead of showing nothing to do', () => {
    render(
      <BatchHeader
        batch={batch}
        route={{ tab: 'capture' }}
        attention={undefined}
        attentionUnavailable
        activeLotCount={8}
        retiredLotCount={0}
        busy={false}
        onArchive={vi.fn()}
      />,
    )

    expect(screen.getByText('Needs you unavailable')).toBeInTheDocument()
  })

  it('reads every tab count from the attention read, warnings apart from plain counts', () => {
    header({ tab: 'capture' })
    const tabs = within(screen.getByRole('navigation', { name: 'Batch' }))

    expect(tabs.getByRole('link', { name: 'Capture' })).toHaveAttribute('aria-current', 'page')
    expect(tabs.getByRole('link', { name: 'Processing, 3 questions' })).toHaveAttribute(
      'href',
      `#${batchId}/processing/overview`,
    )
    expect(tabs.getByRole('link', { name: 'Review, 8 to check, 3 to decide' })).toBeInTheDocument()
    expect(tabs.getByRole('link', { name: 'Changes, 6 ready, 2 to check' })).toHaveAttribute(
      'href',
      `#${batchId}/changes/ready`,
    )
    expect(tabs.queryByRole('link', { name: /Approve|Results/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: /views|steps/ })).not.toBeInTheDocument()
  })

  it('shows a hidden screen that needs the operator in the second row', () => {
    header({ tab: 'review', view: 'lots' })
    const views = within(screen.getByRole('navigation', { name: 'Review views' }))

    expect(views.getByRole('link', { name: 'Lots, 8 lots, 8 to check' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(views.getByRole('link', { name: 'Records, 46 records, 3 to decide' })).toHaveAttribute(
      'href',
      `#${batchId}/review/records`,
    )
    // The Map's count needs the media read, which this render does not give.
    expect(views.getByRole('link', { name: 'Map' })).toHaveAttribute(
      'href',
      `#${batchId}/review/map`,
    )
  })

  it('lists the Processing steps and the Changes views', () => {
    const { unmount } = header({ tab: 'processing', step: 'examine' })
    const steps = within(screen.getByRole('navigation', { name: 'Processing steps' }))
    expect(steps.getAllByRole('link').map((link) => link.textContent?.replace(/\d.*/, ''))).toEqual(
      ['Overview', 'Examine', 'Research', 'Images', 'Inventory'],
    )
    expect(steps.getByRole('link', { name: /^Examine/ })).toHaveAttribute('aria-current', 'page')
    unmount()

    header({ tab: 'changes', view: 'added' })
    const views = within(screen.getByRole('navigation', { name: 'Changes views' }))
    expect(views.getByRole('link', { name: 'Added, 1 run, 2 need attention' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(views.getByRole('link', { name: 'Ready to add, 6 lots' })).toBeInTheDocument()
  })

  it('counts Capture files and the Map unused photos from the media read', () => {
    const { unmount } = header({ tab: 'review', view: 'map' }, { files: 9, unused: 1 })
    const tabs = within(screen.getByRole('navigation', { name: 'Batch' }))
    const views = within(screen.getByRole('navigation', { name: 'Review views' }))

    expect(tabs.getByRole('link', { name: 'Capture, 9 files' })).toBeInTheDocument()
    expect(views.getByRole('link', { name: 'Map, 1 unused photo' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    unmount()

    header({ tab: 'review', view: 'map' }, { files: 9, unused: 0 })
    expect(
      within(screen.getByRole('navigation', { name: 'Review views' })).getByRole('link', {
        name: 'Map',
      }),
    ).toBeInTheDocument()
  })

  it('offers a way back to Batches above the title at phone width, where the masthead drops its trail', () => {
    header({ tab: 'capture' })

    // Shown only below bp-compact, which jsdom cannot match, so it has no computed name here.
    const back = screen.getByText('Batches', { exact: false, selector: 'a' })
    expect(back).toHaveAttribute('href', '#')
    expect(back.compareDocumentPosition(screen.getByRole('heading', { level: 1 }))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })
})
