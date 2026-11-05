import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { BatchAttentionDto } from '@invimport/contracts'
import { IntakeRequestError } from '@invimport/contracts/client'
import { describe, expect, it, vi } from 'vitest'
import type { ProcessingSource } from '../../processing/source'
import { InstructionField } from './InstructionField'
import { ProcessingOverview } from './ProcessingOverview'

const b = 'b0000000-0000-4000-8000-000000000001'
const none = { questions: 0, failed: 0 }

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
  jobsOn: () => [],
}

const attention = {
  batch_id: b,
  revision: '4',
  processing: {
    questions: 1,
    failed: 1,
    steps: { examine: none, research: none, images: none, inventory: none },
  },
  review: { to_check: 8, changed_after_review: 0, to_decide: 2 },
  changes: { ready: 3, failed: 0, uncertain: 0 },
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

  it('lists open questions with their step and assumption, each opening it', () => {
    overview()
    const needs = screen.getByRole('region', { name: 'Needs you' })

    expect(within(needs).getByRole('link', { name: /Is the last letter a P\?/ })).toHaveAttribute(
      'href',
      `#${b}/processing/examine/q1`,
    )
    expect(within(needs).getByText(/Assuming ATmega328P/)).toBeInTheDocument()
    expect(within(needs).getByText(/Examine · Packet A/)).toBeInTheDocument()
    expect(within(needs).getByRole('link', { name: 'Open Packet A in Review' })).toHaveAttribute(
      'href',
      `#${b}/review/lots/l1`,
    )
  })

  it('claims no agent sessions when the source has none', () => {
    overview()

    expect(screen.queryByRole('region', { name: 'Sessions' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Open session/ })).not.toBeInTheDocument()
  })

  it('lists sessions with their step, subject and state, each opening its drawer', async () => {
    const onOpenSession = vi.fn()
    overview({
      source: {
        ...source,
        sessions: [{ jobId: 'j2', step: 'research', subject: 'Packet B', state: 'waiting_input' }],
      },
      onOpenSession,
    })
    const sessions = screen.getByRole('region', { name: 'Sessions' })

    expect(within(sessions).getByText('Research · Packet B')).toBeInTheDocument()
    expect(within(sessions).getByText('Waiting for you')).toBeInTheDocument()
    await userEvent.click(
      within(sessions).getByRole('button', { name: 'Open session for Packet B' }),
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

  it('says where to set instructions when this setup cannot save them', () => {
    render(<InstructionField text="" revision="4" instruct={undefined} onDirtyChange={vi.fn()} />)

    expect(screen.getByLabelText('Instructions for the whole batch')).toBeDisabled()
    expect(screen.getByText(/not available in this setup/)).toBeInTheDocument()
  })
})
