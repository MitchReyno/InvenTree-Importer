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

function precedes(first: Element, second: Element) {
  return Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING)
}

function header(route: Parameters<typeof BatchHeader>[0]['route'], unusedFiles?: number) {
  return render(
    <BatchHeader
      batch={batch}
      route={route}
      attention={attention}
      unusedFiles={unusedFiles}
      activeLotCount={8}
      busy={false}
      onArchive={vi.fn()}
    />,
  )
}

describe('BatchHeader', () => {
  it('counts Processing by its questions only; failed attempts stay in the need-you list', () => {
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
          items: [],
        }}
        activeLotCount={8}
        busy={false}
        onArchive={vi.fn()}
      />,
    )
    const tabs = within(screen.getByRole('navigation', { name: 'Batch' }))
    const steps = within(screen.getByRole('navigation', { name: 'Processing steps' }))

    expect(tabs.getByRole('link', { name: 'Processing, 3 questions' })).toBeInTheDocument()
    // Overview carries no count: the pill and the Processing tab already show the questions.
    expect(steps.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page')
    expect(steps.getByRole('link', { name: 'Research' })).toBeInTheDocument()
  })

  it('marks each step running or done with an icon, and counts its progress or questions', () => {
    render(
      <BatchHeader
        batch={batch}
        route={{ tab: 'processing', step: 'research' }}
        attention={{
          ...attention,
          processing: {
            questions: 1,
            failed: 0,
            running: 2,
            steps: {
              ...noSteps,
              examine: { questions: 1, failed: 0, jobs: 3, ready: 3, running: 0 },
              research: { questions: 0, failed: 0, jobs: 12, ready: 7, running: 2 },
            },
          },
          items: [],
        }}
        activeLotCount={8}
        busy={false}
        onArchive={vi.fn()}
      />,
    )
    const tabs = within(screen.getByRole('navigation', { name: 'Batch' }))
    const steps = within(screen.getByRole('navigation', { name: 'Processing steps' }))

    expect(tabs.getByRole('link', { name: 'Processing, running, 1 question' })).toBeInTheDocument()
    const examine = steps.getByRole('link', { name: 'Examine, done, 1 question' })
    expect(examine).toHaveTextContent('✓')
    expect(examine.querySelector('[data-tone="warn"]')).toHaveTextContent('1')
    const research = steps.getByRole('link', { name: 'Research, running, 7 of 12 ready' })
    expect(research.querySelector('[data-tone="default"]')).toHaveTextContent('7/12')
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
        busy={false}
        onArchive={vi.fn()}
      />,
    )

    expect(screen.getByText('Needs you unavailable')).toBeInTheDocument()
  })

  it('gives each tab one count: Capture none, Processing its questions, Review lots to check, Changes lots ready', () => {
    header({ tab: 'capture' }, 1)
    const nav = screen.getByRole('navigation', { name: 'Batch' })
    const tabs = within(nav)

    expect(tabs.getByRole('link', { name: 'Capture' })).toHaveAttribute('aria-current', 'page')
    const processing = tabs.getByRole('link', { name: 'Processing, 3 questions' })
    expect(processing).toHaveAttribute('href', `#${batchId}/processing/overview`)
    expect(processing.querySelector('[data-tone="warn"]')).toHaveTextContent('3')
    const review = tabs.getByRole('link', { name: 'Review, 8 to check' })
    expect(review.querySelector('[data-tone="default"]')).toHaveTextContent('8')
    const changes = tabs.getByRole('link', { name: 'Changes, 6 ready to add' })
    expect(changes).toHaveAttribute('href', `#${batchId}/changes/ready`)
    expect(changes.querySelector('[data-tone="ok"]')).toHaveTextContent('6')
    for (const tab of tabs.getAllByRole('link')) {
      expect(tab.querySelectorAll('[data-tone]').length).toBeLessThanOrEqual(1)
    }
    // Counts are numbers, never phrases such as "8 to check".
    expect(nav).not.toHaveTextContent(/to check|to decide|ready/)
    expect(tabs.queryByRole('link', { name: /Approve|Results/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: /views|steps/ })).not.toBeInTheDocument()
  })

  it('shows a hidden screen that needs the operator in the second row', () => {
    header({ tab: 'review', view: 'lots' })
    const views = within(screen.getByRole('navigation', { name: 'Review views' }))

    expect(views.getByRole('link', { name: 'Lots, 8 lots' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    const records = views.getByRole('link', { name: 'Records, 3 to decide' })
    expect(records).toHaveAttribute('href', `#${batchId}/review/records`)
    expect(records.querySelector('[data-tone="warn"]')).toHaveTextContent('3')
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
    const added = views.getByRole('link', { name: 'Added, 2 need attention' })
    expect(added).toHaveAttribute('aria-current', 'page')
    expect(added.querySelector('[data-tone="bad"]')).toHaveTextContent('2')
    expect(views.getByRole('link', { name: 'Ready to add, 6 ready to add' })).toBeInTheDocument()
  })

  it('counts the Map by its unused files and gives Capture no count', () => {
    const { unmount } = header({ tab: 'review', view: 'map' }, 1)
    const tabs = within(screen.getByRole('navigation', { name: 'Batch' }))
    const views = within(screen.getByRole('navigation', { name: 'Review views' }))

    expect(tabs.getByRole('link', { name: 'Capture' })).toBeInTheDocument()
    expect(views.getByRole('link', { name: 'Map, 1 unused file' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    unmount()

    // No count while lineage is unknown, as with none unused: the Map shows no badge.
    header({ tab: 'review', view: 'map' })
    expect(
      within(screen.getByRole('navigation', { name: 'Review views' })).getByRole('link', {
        name: 'Map',
      }),
    ).toBeInTheDocument()
  })

  it('puts a short summary beside the title and the tabs on their own row under it', () => {
    header({ tab: 'capture' })
    const title = screen.getByRole('heading', { level: 1, name: batch.title })
    const summary = screen.getByText('8 lots · 6 ready to add')

    expect(precedes(title, summary)).toBe(true)
    expect(precedes(summary, screen.getByRole('navigation', { name: 'Batch' }))).toBe(true)
    // The title appears once: as the heading.
    expect(screen.getAllByText(batch.title)).toHaveLength(1)
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
