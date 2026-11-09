import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { BatchAttentionDto } from '@invimport/contracts'
import { IntakeRequestError } from '@invimport/contracts/client'
import { describe, expect, it, vi } from 'vitest'
import type { ProcessingSource } from '../../processing/source'
import { InstructionField } from './InstructionField'
import { ProcessingOverview } from './ProcessingOverview'

const b = 'b0000000-0000-4000-8000-000000000001'
const none = { questions: 0, failed: 0, jobs: 0, ready: 0, running: 0 }

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
      prompt: 'Is the last letter a P?',
      assumption: 'Assuming ATmega328P',
      lotId: 'l1',
    },
  ],
  sessions: [],
  lead: null,
  jobsOn: () => [],
  pipeline: { lead: null, lots: [] },
}

const attention = {
  batch_id: b,
  revision: '4',
  processing: {
    questions: 1,
    failed: 1,
    running: 0,
    steps: { examine: none, research: none, images: none, inventory: none },
  },
  review: { to_check: 8, changed_after_review: 0, to_decide: 2, records: 0 },
  changes: { ready: 3, failed: 0, uncertain: 0, runs: 0 },
  items: [],
  items_truncated: false,
} as BatchAttentionDto

function overview(overrides: Partial<Parameters<typeof ProcessingOverview>[0]> = {}) {
  return render(
    <ProcessingOverview
      batchId={b}
      source={source}
      attention={attention}
      instructions={<p>Instructions slot</p>}
      onOpenSession={vi.fn()}
      activity={[]}
      {...overrides}
    />,
  )
}

describe('ProcessingOverview', () => {
  it('shows each step in counts, and says when a step has no work', () => {
    overview()
    const steps = screen.getByRole('list', { name: 'Steps' })

    expect(within(steps).getByRole('link', { name: /Examine/ })).toHaveAttribute(
      'href',
      `#${b}/processing/examine`,
    )
    expect(within(steps).getByText('2 ready · 1 running · 1 question')).toBeInTheDocument()
    expect(within(steps).getByText('1 failed')).toBeInTheDocument()
    expect(within(steps).getAllByText('No work yet')).toHaveLength(2)
    expect(screen.queryByText(/%/)).not.toBeInTheDocument()
  })

  it('lists open questions as Needs you rows, each answering its question', () => {
    overview()
    const needs = screen.getByRole('region', { name: 'Needs you' })

    expect(
      within(needs).getByRole('link', { name: 'Answer: Is the last letter a P?' }),
    ).toHaveAttribute('href', `#${b}/processing/examine/q1`)
    expect(within(needs).getByText('Examine')).toBeInTheDocument()
    expect(within(needs).getByText('Packet A · Assuming ATmega328P')).toBeInTheDocument()
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
    // Running work takes the accent colour, as everywhere else.
    expect(within(sessions).getByText('Running').closest('[data-tone]')).toHaveAttribute(
      'data-tone',
      'acc',
    )
    await userEvent.click(
      within(sessions).getByRole('button', { name: 'Open session: Research · Packet B' }),
    )
    expect(onOpenSession).toHaveBeenCalledWith('j2')
  })

  it('links to Review and Changes with their counts, and offers no lot editing', () => {
    overview()

    expect(screen.getByRole('link', { name: '8 lots to check' })).toHaveAttribute(
      'href',
      `#${b}/review/lots`,
    )
    expect(screen.getByRole('link', { name: '3 ready to add' })).toHaveAttribute(
      'href',
      `#${b}/changes/ready`,
    )
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
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

  it('says a saved instruction reaches running agents and wakes finished ones', () => {
    render(<InstructionField text="" revision="4" instruct={undefined} onDirtyChange={vi.fn()} />)
    expect(
      screen.getByText(
        'Saved for the batch and sent to its agents: running ones pick it up as they work, and finished ones are woken to apply it. Instructions do not approve inventory values.',
      ),
    ).toBeInTheDocument()
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
    expect(screen.getByRole('alert')).toHaveTextContent('Saved, but the agents could not be told yet.')
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
    expect(within(progress).getByText('Examine: running')).toBeInTheDocument()
    expect(within(progress).getByText('Research: failed')).toBeInTheDocument()
  })

  it('puts sessions and the rest of the batch in an aside', () => {
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
      '1 running',
    )
    expect(within(aside).getByRole('link', { name: '8 lots to check' })).toBeVisible()
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
        { text: 'Research · Packet B: Checking the datasheet', time: '13:07' },
        { text: 'Examine · Whole batch: Grouping the reels', time: '13:09', current: true },
      ],
    })
    const timeline = screen.getByRole('list', { name: 'Recent activity' })
    expect(within(timeline).getAllByRole('listitem')).toHaveLength(2)
  })

  it('names unused files, when the session started and the slot limit', () => {
    overview({
      unusedFiles: 1,
      started: '13:02',
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
    expect(screen.getByRole('link', { name: '1 file not used by any lot' })).toHaveAttribute(
      'href',
      `#${b}/review/map`,
    )
    expect(screen.getByRole('region', { name: 'Progress' })).toHaveTextContent('Started 13:02')
    expect(screen.getByRole('region', { name: 'Agent sessions' })).toHaveTextContent(
      '1 running · limit 3',
    )
  })

  it('says how many lots were formed and by when, beside the start time', () => {
    overview({ started: '13:02', lotsFormed: '5 lots formed by 13:20' })
    expect(screen.getByRole('region', { name: 'Progress' })).toHaveTextContent(
      'Started 13:02 · 5 lots formed by 13:20',
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
    expect(screen.getByText('Examine: waiting')).toBeInTheDocument()
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
})
