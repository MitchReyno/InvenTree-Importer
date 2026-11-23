import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ProcessingSource } from '#/processing/source'
import { StepPage } from './StepPage'

const b = 'b0000000-0000-4000-8000-000000000001'

const source: ProcessingSource = {
  steps: [
    {
      step: 'examine',
      label: 'Examine',
      jobs: 2,
      queued: 0,
      running: 1,
      waiting: 0,
      ready: 1,
      failed: 0,
      questions: 1,
    },
    {
      step: 'research',
      label: 'Research',
      jobs: 0,
      queued: 0,
      running: 0,
      waiting: 0,
      ready: 0,
      failed: 0,
      questions: 0,
    },
    {
      step: 'images',
      label: 'Images',
      jobs: 0,
      queued: 0,
      running: 0,
      waiting: 0,
      ready: 0,
      failed: 0,
      questions: 0,
    },
    {
      step: 'inventory',
      label: 'Inventory',
      jobs: 0,
      queued: 0,
      running: 0,
      waiting: 0,
      ready: 0,
      failed: 0,
      questions: 0,
    },
  ],
  questions: [
    {
      id: 'q1',
      jobId: 'j1',
      step: 'examine',
      subject: 'Packet A',
      title: 'Is it a P?',
      kind: 'in words',
      assumption: null,
      lotId: null,
    },
  ],
  sessions: [
    {
      jobId: 'j2',
      step: 'examine',
      subject: 'Packet B',
      lotId: null,
      state: 'running',
      status: null,
    },
  ],
  lead: null,
  jobsOn: () => [],
}

describe('StepPage', () => {
  it('shows the step state, its questions, its sessions and its outputs, and links to Capture', async () => {
    const onOpenSession = vi.fn()
    render(
      <StepPage
        batchId={b}
        step="examine"
        source={source}
        summary={{ text: '3 lots formed', state: 'working' }}
        onOpenSession={onOpenSession}
      >
        <p>Output cards</p>
      </StepPage>,
    )

    expect(screen.getByRole('heading', { name: 'Examine' })).toBeInTheDocument()
    const head = screen.getByRole('heading', { name: 'Examine' }).parentElement!
    // The step's own sessions are counted with it; the other steps' are not.
    expect(head).toHaveTextContent('3 lots formed · 1 session')
    expect(within(head).getByText('Working')).toBeInTheDocument()
    expect(
      within(screen.getByRole('region', { name: 'Questions' })).getByRole('link', {
        name: 'Is it a P?',
      }),
    ).toHaveAttribute('href', `#${b}/processing/examine/q1`)
    await userEvent.click(screen.getByRole('button', { name: 'Open session: Examine · Packet B' }))
    expect(onOpenSession).toHaveBeenCalledWith('j2')
    expect(
      within(screen.getByRole('region', { name: 'Outputs' })).getByText('Output cards'),
    ).toBeVisible()
    expect(screen.getByRole('link', { name: 'Evidence in Capture' })).toHaveAttribute(
      'href',
      `#${b}/capture`,
    )
  })

  it('says a step has no retained work instead of inventing progress or sessions', () => {
    render(
      <StepPage
        batchId={b}
        step="research"
        source={source}
        summary={{ text: 'No work yet', state: 'not_started' }}
        onOpenSession={vi.fn()}
      />,
    )

    expect(screen.getByText('No work yet')).toBeInTheDocument()
    expect(screen.getByText('Not started')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Sessions' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Questions' })).not.toBeInTheDocument()
  })

  it('counts only its own step, as its own section does', () => {
    render(
      <StepPage
        batchId={b}
        step="research"
        source={source}
        summary={{ text: '1 lot · 1 done', state: 'done' }}
        onOpenSession={vi.fn()}
      />,
    )
    const head = screen.getByRole('heading', { name: 'Research' }).parentElement!

    expect(head).toHaveTextContent('Research')
    expect(head).toHaveTextContent('1 lot · 1 done')
    expect(head).not.toHaveTextContent(/ready|session/)
  })

  it('opens with the focused lot’s state when the step has no output for it yet', () => {
    render(
      <StepPage
        batchId={b}
        step="images"
        source={source}
        summary={{ text: 'No work yet', state: 'not_started' }}
        focus={{ label: 'GE S2CN1 diodes', state: 'not_started' }}
        onOpenSession={vi.fn()}
      />,
    )
    const focus = screen.getByRole('region', { name: 'GE S2CN1 diodes' })

    expect(focus).toHaveTextContent('No Images output for this lot yet')
    expect(within(focus).getByText('Not started')).toBeInTheDocument()
  })

  it('leaves the focused lot to its outputs once it has a result', () => {
    render(
      <StepPage
        batchId={b}
        step="research"
        source={source}
        summary={{ text: '1 lot · 1 done', state: 'done' }}
        focus={{ label: 'GE S2CN1 diodes', state: 'done' }}
        onOpenSession={vi.fn()}
      />,
    )

    expect(screen.queryByText(/output for this lot yet/)).toBeNull()
  })
})
