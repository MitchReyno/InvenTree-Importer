import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IntakeRequestError } from '@invimport/contracts/client'
import type { BatchAttentionDto } from '@invimport/contracts'
import { describe, expect, it, vi } from 'vitest'
import type { ProcessingSource } from '#/processing/source'
import type { LotSteps } from '#/processing/lot-steps'
import { InstructionField } from './InstructionField'
import { ProcessingOverview } from './ProcessingOverview'
import { eventTimeText } from '#/components/ui'

const b = 'b0000000-0000-4000-8000-000000000001'

const step = (name: 'examine' | 'research' | 'images' | 'inventory', label: string, jobs = 0) => ({
  step: name,
  label,
  jobs,
  queued: 0,
  running: 0,
  waiting: 0,
  ready: 0,
  failed: 0,
  questions: 0,
  readyLots: 0,
  lots: 0,
})

const source: ProcessingSource = {
  steps: [
    { ...step('examine', 'Examine', 3), ready: 2, running: 1, questions: 1 },
    { ...step('research', 'Research', 1), failed: 1 },
    step('images', 'Images'),
    step('inventory', 'Inventory'),
  ],
  questions: [
    {
      id: 'q1',
      jobId: 'j1',
      step: 'examine',
      subject: 'Packet A',
      title: 'Is the last letter a P?',
      kind: 'in words',
      assumption: 'Assuming ATmega328P',
      lotId: 'l1',
    },
  ],
  sessions: [],
  lead: null,
  jobsOn: () => [],
}

const noSteps = {
  examine: {
    questions: 0,
    failed: 0,
    jobs: 0,
    ready: 0,
    running: 0,
    waiting: 0,
    queued: 0,
    ready_lots: 0,
  },
  research: {
    questions: 0,
    failed: 0,
    jobs: 0,
    ready: 0,
    running: 0,
    waiting: 0,
    queued: 0,
    ready_lots: 0,
  },
  images: {
    questions: 0,
    failed: 0,
    jobs: 0,
    ready: 0,
    running: 0,
    waiting: 0,
    queued: 0,
    ready_lots: 0,
  },
  inventory: {
    questions: 0,
    failed: 0,
    jobs: 0,
    ready: 0,
    running: 0,
    waiting: 0,
    queued: 0,
    ready_lots: 0,
  },
}

/** The batch attention read: no agent questions, two Review decisions, so the header says 2. */
const attention: BatchAttentionDto = {
  batch_id: b,
  revision: '3',
  processing: { questions: 0, failed: 0, running: 0, lots: 0, paused: false, steps: noSteps },
  review: { to_check: 0, changed_after_review: 0, needs_answer: 0, to_decide: 2, records: 2 },
  changes: { ready: 0, failed: 0, uncertain: 0, runs: 0 },
  items: [
    {
      key: 'decision:r1',
      group: 'decision',
      tab: 'review',
      title: 'Choose the 1N4148 part',
      detail: 'Two records match',
      route: `${b}/review/records/part/r1`,
    },
    {
      key: 'decision:r2',
      group: 'decision',
      tab: 'review',
      title: 'Choose the BC547 part',
      detail: null,
      route: `${b}/review/records/part/r2`,
    },
  ],
  items_truncated: false,
}

const diodes = 'a0000000-0000-4000-8000-00000000000a'

const notStarted = { state: 'not_started' as const, job: null, partId: null, hasOutput: false }

const lots: LotSteps[] = [
  {
    lotId: diodes,
    label: 'GE S2CN1 diodes',
    steps: {
      research: { state: 'done', job: { id: 'j2' } as never, partId: null, hasOutput: true },
      images: { state: 'working', job: { id: 'j3' } as never, partId: 'p1', hasOutput: false },
      inventory: notStarted,
    },
  },
]

function overview(overrides: Partial<Parameters<typeof ProcessingOverview>[0]> = {}) {
  return render(
    <ProcessingOverview
      batchId={b}
      source={source}
      instructions={<p>Instructions slot</p>}
      onOpenSession={vi.fn()}
      activity={[]}
      attention={attention}
      lots={lots}
      {...overrides}
    />,
  )
}

describe('ProcessingOverview', () => {
  it('labels each step of the bar with its count, linking to its step page', () => {
    overview()
    const steps = screen.getByRole('list', { name: 'Steps' })

    expect(within(steps).getByRole('link', { name: 'Examine · 2 of 3' })).toHaveAttribute(
      'href',
      `#${b}/processing/examine`,
    )
    expect(within(steps).getByRole('link', { name: 'Research · 0 of 1' })).toHaveAttribute(
      'href',
      `#${b}/processing/research`,
    )
    expect(within(steps).getByRole('link', { name: 'Images' })).toBeInTheDocument()
    // Each step's state shows once: the bar and its links, with no line repeating it.
    expect(within(steps).queryByText(/ready|running|failed|No work yet/)).toBeNull()
    expect(screen.queryByText(/%/)).not.toBeInTheDocument()
  })

  it('lists everything the header counts in Needs you, tagged with its tab', () => {
    overview()
    const needs = screen.getByRole('region', { name: 'Needs you' })

    expect(within(needs).getByRole('region', { name: 'Records · Review' })).toBeInTheDocument()
    expect(
      within(needs).getByRole('link', { name: 'Decide: Choose the 1N4148 part' }),
    ).toHaveAttribute('href', `#${b}/review/records/part/r1`)
    expect(within(needs).getByRole('link', { name: 'Decide: Choose the BC547 part' })).toBeVisible()
    expect(needs).not.toHaveTextContent('No open questions')
  })

  it('puts agent questions first, with their step and the assumption in use', () => {
    overview({
      attention: {
        ...attention,
        items: [
          ...attention.items,
          {
            key: 'question:q1',
            group: 'question',
            tab: 'processing',
            title: 'Is the last letter a P?',
            detail: null,
            question: { steps: [{ kind: 'text', assumption: 'Assuming ATmega328P' }] },
            route: `${b}/processing/examine/q1`,
          },
        ],
      },
    })
    const needs = screen.getByRole('region', { name: 'Needs you' })
    const sections = within(needs).getAllByRole('region')

    expect(sections[0]).toHaveAccessibleName('Questions · Processing')
    expect(
      within(sections[0]).getByRole('link', { name: 'Answer: Is the last letter a P?' }),
    ).toHaveAttribute('href', `#${b}/processing/examine/q1`)
    expect(within(sections[0]).getByText('Examine')).toBeInTheDocument()
    expect(within(sections[0]).getByText('Assuming ATmega328P')).toBeInTheDocument()
  })

  it('says when Needs you shows only the first items, as the header popover does', () => {
    overview({ attention: { ...attention, items_truncated: true } })

    expect(screen.getByRole('region', { name: 'Needs you' })).toHaveTextContent(
      'Showing the first 2. Each tab shows the rest.',
    )
  })

  it('says nothing needs the operator only from the attention read', () => {
    const { unmount } = overview({ attention: { ...attention, items: [] } })
    expect(screen.getByRole('region', { name: 'Needs you' })).toHaveTextContent(
      'Nothing needs you.',
    )
    unmount()

    overview({ attention: undefined, source: { ...source, questions: [] } })
    const needs = screen.getByRole('region', { name: 'Needs you' })
    expect(needs).toHaveTextContent('Updating…')
    expect(needs).not.toHaveTextContent(/Nothing needs you|No open questions/)
  })

  it('says Needs you is partial when the attention read failed, keeping the agent questions', () => {
    const { unmount } = overview({ attention: undefined, attentionUnavailable: true })
    const needs = screen.getByRole('region', { name: 'Needs you' })
    expect(needs).toHaveTextContent('Review and Changes items are not listed')
    expect(
      within(needs).getByRole('link', { name: 'Answer: Is the last letter a P?' }),
    ).toBeVisible()
    expect(needs).not.toHaveTextContent('Updating…')
    unmount()

    overview({
      attention: undefined,
      attentionUnavailable: true,
      source: { ...source, questions: [] },
    })
    const empty = screen.getByRole('region', { name: 'Needs you' })
    expect(empty).toHaveTextContent('Needs you is unavailable')
    expect(empty).not.toHaveTextContent(/Updating…|Nothing needs you/)
  })

  it('shows each lot’s Research, Images and Inventory as state pills linking to that lot’s step', () => {
    overview()
    const table = screen.getByRole('table', { name: 'Lots' })
    const row = within(table).getByRole('row', { name: /GE S2CN1 diodes/ })

    expect(within(row).getByRole('link', { name: 'Research: Done' })).toHaveAttribute(
      'href',
      `#${b}/processing/research?lot=${diodes}`,
    )
    expect(within(row).getByRole('link', { name: 'Images: Working' })).toHaveAttribute(
      'href',
      `#${b}/processing/images?lot=${diodes}`,
    )
    expect(within(row).getByRole('link', { name: 'Inventory: Not started' })).toBeVisible()
    expect(screen.queryByRole('region', { name: 'Pipeline' })).toBeNull()
  })

  it('claims no agent sessions when the source has none', () => {
    overview()

    expect(screen.queryByRole('region', { name: 'Agent sessions' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Open session/ })).not.toBeInTheDocument()
  })

  it('lists sessions with their step, subject and state, each opening its drawer', async () => {
    const onOpenSession = vi.fn()
    overview({
      source: {
        ...source,
        sessions: [
          {
            jobId: 'j2',
            step: 'research',
            subject: 'Packet B',
            lotId: null,
            state: 'waiting_input',
            status: 'Checking the datasheet',
          },
          {
            jobId: 'j3',
            step: 'images',
            subject: 'Packet C',
            lotId: null,
            state: 'running',
            status: null,
          },
        ],
      },
      onOpenSession,
    })
    const sessions = screen.getByRole('region', { name: 'Agent sessions' })
    // The heading is the touchpoint; the session rows are not marked.
    expect(
      within(sessions)
        .getByRole('heading', { name: 'Agent sessions' })
        .querySelector('[data-ai-mark]'),
    ).not.toBeNull()
    expect(within(sessions).getAllByRole('button')[0].querySelector('[data-ai-mark]')).toBeNull()

    const research = within(sessions).getByRole('button', {
      name: 'Open session: Research · Packet B',
    })
    // A neutral step chip, then the lot in bold, as on the canvas; the row is one target.
    expect(within(research).getByText('Research').closest('[data-tone]')).toHaveAttribute(
      'data-tone',
      'neutral',
    )
    expect(within(research).getByText('Packet B').tagName).toBe('B')
    expect(within(sessions).getByText('Checking the datasheet')).toBeInTheDocument()
    expect(within(sessions).getAllByRole('listitem')[1]).not.toHaveTextContent('Checking')
    expect(within(sessions).getByText('Waiting for you')).toBeInTheDocument()
    // Working takes the accent colour, as everywhere else.
    expect(within(sessions).getByText('Working').closest('[data-tone]')).toHaveAttribute(
      'data-tone',
      'acc',
    )
    await userEvent.click(
      within(sessions).getByRole('button', { name: 'Open session: Research · Packet B' }),
    )
    expect(onOpenSession).toHaveBeenCalledWith('j2')
  })

  it('leaves the Review and Changes counts to the tabs, and offers no lot editing', () => {
    overview()

    expect(screen.queryByRole('navigation', { name: 'Elsewhere in this batch' })).toBeNull()
    expect(screen.queryByRole('link', { name: /to check|ready to add|not used/ })).toBeNull()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('heads Needs you without a count, which the batch header already shows', () => {
    overview()
    const needs = screen.getByRole('region', { name: 'Needs you' })

    expect(within(needs).getByRole('heading', { name: 'Needs you' })).toBeVisible()
    expect(within(needs).queryByText('1')).toBeNull()
  })

  it('says behind its help that closing the browser does not cancel saved work', async () => {
    const user = userEvent.setup()
    overview()
    const progress = screen.getByRole('region', { name: 'Progress' })

    expect(progress).not.toHaveTextContent('Closing this browser')
    await user.click(within(progress).getByRole('button', { name: 'About Processing' }))
    expect(screen.getByText(/Closing this browser does not cancel saved work/)).toBeVisible()
  })
})

describe('InstructionField', () => {
  it('saves the batch instructions explicitly against the batch revision', async () => {
    const instruct = vi.fn(async () => undefined)
    const onDirtyChange = vi.fn()
    render(
      <InstructionField
        text="Keep packets apart."
        revision="4"
        instruct={instruct}
        onDirtyChange={onDirtyChange}
      />,
    )
    const field = screen.getByLabelText('Instructions for the whole batch')
    await userEvent.type(field, ' Check date codes.')
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)

    await userEvent.click(screen.getByRole('button', { name: 'Save instructions' }))
    expect(instruct).toHaveBeenCalledWith(
      'Keep packets apart. Check date codes.',
      '4',
      expect.any(String),
    )
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
  })

  it('keeps the draft and says so when the batch changed meanwhile', async () => {
    const instruct = vi.fn(async () => {
      throw new IntakeRequestError(412, 'revision_conflict')
    })
    render(<InstructionField text="" revision="4" instruct={instruct} onDirtyChange={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('Instructions for the whole batch'), 'Keep apart')
    await userEvent.click(screen.getByRole('button', { name: 'Save instructions' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/changed since/)
    expect(screen.getByLabelText('Instructions for the whole batch')).toHaveValue('Keep apart')
  })

  it('waits for the saved instructions, then shows them without offering an empty save', async () => {
    const instruct = vi.fn(async () => undefined)
    const { rerender } = render(
      <InstructionField
        text={undefined}
        revision="4"
        instruct={instruct}
        onDirtyChange={vi.fn()}
      />,
    )
    expect(screen.getByLabelText('Instructions for the whole batch')).toBeDisabled()
    expect(screen.getByText('Reading the saved instructions…')).toBeInTheDocument()

    rerender(
      <InstructionField
        text="Keep packets apart."
        revision="5"
        instruct={instruct}
        onDirtyChange={vi.fn()}
      />,
    )
    expect(screen.getByLabelText('Instructions for the whole batch')).toHaveValue(
      'Keep packets apart.',
    )
    expect(screen.getByRole('button', { name: 'Save instructions' })).toBeDisabled()
  })

  it('discards a draft back to the saved instructions and releases the guard', async () => {
    const onDirtyChange = vi.fn()
    render(
      <InstructionField
        text="Saved."
        revision="4"
        instruct={vi.fn()}
        onDirtyChange={onDirtyChange}
      />,
    )
    await userEvent.type(screen.getByLabelText('Instructions for the whole batch'), ' Draft')
    await userEvent.click(screen.getByRole('button', { name: 'Discard changes' }))

    expect(screen.getByLabelText('Instructions for the whole batch')).toHaveValue('Saved.')
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
  })

  it('says the saved instructions are unavailable instead of reading forever', () => {
    render(
      <InstructionField
        text={undefined}
        unavailable
        revision="4"
        instruct={vi.fn()}
        onDirtyChange={vi.fn()}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('The saved instructions are unavailable')
    expect(screen.queryByText(/Reading the saved instructions/)).not.toBeInTheDocument()
  })

  it('gives the archive as the reason instructions cannot change', () => {
    render(
      <InstructionField
        text="Saved."
        revision="4"
        instruct={undefined}
        readOnlyReason="Resume the batch to change its instructions."
        onDirtyChange={vi.fn()}
      />,
    )

    expect(screen.getByText('Resume the batch to change its instructions.')).toBeInTheDocument()
    expect(screen.queryByText(/not available in this setup/)).not.toBeInTheDocument()
  })

  it('says where to set instructions when this setup cannot save them', () => {
    render(<InstructionField text="" revision="4" instruct={undefined} onDirtyChange={vi.fn()} />)

    expect(screen.getByLabelText('Instructions for the whole batch')).toBeDisabled()
    expect(screen.getByText(/not available in this setup/)).toBeInTheDocument()
  })

  it('says beside Save that saving reaches running agents and wakes finished ones', async () => {
    const user = userEvent.setup()
    render(<InstructionField text="" revision="4" instruct={vi.fn()} onDirtyChange={vi.fn()} />)

    expect(
      screen.getByText(
        "Saving sends them to the batch's agents: running ones pick them up as they work, and finished ones start again to apply them.",
      ),
    ).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'About batch instructions' }))
    expect(
      await screen.findByRole('dialog', { name: 'About batch instructions' }),
    ).toHaveTextContent('They do not approve inventory values.')
  })

  it('says when saved instructions could not reach the agents, and offers to send them again', async () => {
    const user = userEvent.setup()
    const deliver = vi.fn()
    const view = render(
      <InstructionField
        text="Keep packets apart."
        revision="5"
        instruct={vi.fn()}
        delivery={{ status: 'failed' }}
        deliver={deliver}
        onDirtyChange={vi.fn()}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Saved, but the agents could not be told yet.',
    )
    await user.click(screen.getByRole('button', { name: 'Send to the agents again' }))
    expect(deliver).toHaveBeenCalledOnce()
    view.rerender(
      <InstructionField
        text="Keep packets apart."
        revision="5"
        instruct={vi.fn()}
        delivery={{ status: 'sent', sessions: 2, woken: 1 }}
        deliver={deliver}
        onDirtyChange={vi.fn()}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      'Sent to 2 sessions; 1 finished one is woken to apply it.',
    )
  })

  it('heads the progress card with who is working and draws the steps as one bar', () => {
    overview()
    const progress = screen.getByRole('region', { name: 'Progress' })
    expect(within(progress).getByRole('heading', { name: '1 agent working' })).toBeVisible()
    expect(within(progress).getByRole('list', { name: 'Steps' })).toBeVisible()
    expect(within(progress).getByText('Examine: working')).toBeInTheDocument()
    expect(within(progress).getByText('Research: failed')).toBeInTheDocument()
  })

  it('puts the batch sessions in an aside', () => {
    overview({
      source: {
        ...source,
        sessions: [
          {
            jobId: 'j3',
            step: 'images',
            subject: 'Packet C',
            lotId: null,
            state: 'running',
            status: null,
          },
        ],
      },
    })
    const aside = screen.getByRole('complementary')
    expect(within(aside).getByRole('region', { name: 'Agent sessions' })).toHaveTextContent(
      '1 working',
    )
    expect(within(aside).getByRole('link', { name: 'All sessions, every batch' })).toHaveAttribute(
      'href',
      '#agents',
    )
  })

  it('shows recent activity as a timeline, or says there is none yet', () => {
    const { unmount } = overview()
    expect(screen.getByRole('region', { name: 'Recent activity' })).toHaveTextContent(
      'No agent activity yet.',
    )
    unmount()
    overview({
      activity: [
        { text: 'Research · Packet B: Checking the datasheet', at: '2026-11-23T13:07:00Z' },
        {
          text: 'Examine · Whole batch: Grouping the reels',
          at: '2026-11-23T13:09:00Z',
          current: true,
        },
      ],
    })
    const timeline = screen.getByRole('list', { name: 'Recent activity' })
    expect(within(timeline).getAllByRole('listitem')).toHaveLength(2)
  })

  it('names when the session started and the slot limit', () => {
    const startedAt = new Date().toISOString()
    overview({
      startedAt,
      sessionLimit: 3,
      source: {
        ...source,
        sessions: [
          {
            jobId: 'j3',
            step: 'images',
            subject: 'C',
            lotId: null,
            state: 'running',
            status: null,
          },
        ],
      },
    })
    expect(screen.getByRole('region', { name: 'Progress' })).toHaveTextContent(
      `Started ${eventTimeText(startedAt, Date.now())}`,
    )
    expect(screen.getByRole('region', { name: 'Agent sessions' })).toHaveTextContent(
      '1 working · limit 3',
    )
  })

  it('says how many lots were formed and by when, beside the start time', () => {
    const startedAt = new Date().toISOString()
    const formedAt = new Date().toISOString()
    overview({ startedAt, lotsFormed: { count: 5, at: formedAt } })
    const now = Date.now()
    expect(screen.getByRole('region', { name: 'Progress' })).toHaveTextContent(
      `Started ${eventTimeText(startedAt, now)} · 5 lots formed by ${eventTimeText(formedAt, now)}`,
    )
  })

  it('pauses the batch sessions from the sessions card, and says while they are paused', async () => {
    const pause = vi.fn(async () => undefined)
    const withSession = {
      ...source,
      sessions: [
        { jobId: 'j3', step: 'images', subject: 'C', lotId: null, state: 'running', status: null },
      ],
    } as typeof source
    const { unmount } = overview({ source: withSession, pause: { paused: false, change: pause } })
    const card = screen.getByRole('region', { name: 'Agent sessions' })
    within(card).getByRole('button', { name: 'Pause all' }).click()
    await waitFor(() => expect(pause).toHaveBeenCalledWith(true))
    unmount()

    overview({ source: withSession, pause: { paused: true, change: pause } })
    const paused = screen.getByRole('region', { name: 'Agent sessions' })
    expect(paused).toHaveTextContent('Paused: no session starts new work until you resume.')
    expect(within(paused).getByRole('button', { name: 'Resume' })).toBeVisible()
  })

  it('calls only running work running', () => {
    overview({
      source: {
        ...source,
        steps: [
          { ...source.steps[0], jobs: 1, ready: 0, running: 0, queued: 1, questions: 0 },
          ...source.steps.slice(1),
        ],
      },
    })
    expect(screen.getByText('Examine: queued')).toBeInTheDocument()
  })

  it('describes each session row by its state and latest line', () => {
    overview({
      source: {
        ...source,
        sessions: [
          {
            jobId: 'j2',
            step: 'research',
            subject: 'Packet B',
            lotId: null,
            state: 'waiting_input',
            status: 'Checking the datasheet',
          },
        ],
      },
    })
    expect(
      screen.getByRole('button', { name: 'Open session: Research · Packet B' }),
    ).toHaveAccessibleDescription('Waiting for you Checking the datasheet')
  })

  it('draws the shared stage bar: paused stages hatched to their share, a running turn still working', () => {
    const { container } = overview({
      paused: true,
      source: {
        ...source,
        steps: [
          { ...source.steps[0], jobs: 1, ready: 1, running: 0, questions: 0 },
          { ...source.steps[1], jobs: 4, running: 1, failed: 0, readyLots: 1, lots: 4 },
          { ...source.steps[2], jobs: 4, ready: 3, readyLots: 3, lots: 4 },
          { ...source.steps[3], lots: 4 },
        ],
      },
    })

    const bars = [...container.querySelectorAll<HTMLElement>('[data-animated]')]
    expect(bars.map((bar) => bar.dataset.state)).toEqual(['done', 'working', 'paused', 'paused'])
    expect(bars[2].querySelector('i')).toHaveStyle({ width: '75%' })
    expect(bars.filter((bar) => bar.dataset.animated === 'true')).toHaveLength(1)
  })

  it('keeps every bar still while its read is not current', () => {
    const { container } = overview({ still: true })

    expect(container.querySelector('[data-state="working"]')).not.toBeNull()
    expect(container.querySelectorAll('[data-animated="true"]')).toHaveLength(0)
  })
})
