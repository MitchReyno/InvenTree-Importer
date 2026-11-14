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
      prompt: 'Is it a P?',
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
  pipeline: { lead: null, lots: [] },
}

describe('StepPage', () => {
  it('shows the step state, its questions, its sessions and its outputs, and links to Capture', async () => {
    const onOpenSession = vi.fn()
    render(
      <StepPage batchId={b} step="examine" source={source} onOpenSession={onOpenSession}>
        <p>Output cards</p>
      </StepPage>,
    )

    expect(screen.getByRole('heading', { name: 'Examine' })).toBeInTheDocument()
    expect(screen.getByText('1 ready · 1 running · 1 question')).toBeInTheDocument()
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
    render(<StepPage batchId={b} step="research" source={source} onOpenSession={vi.fn()} />)

    expect(screen.getByText('No retained work on Research yet.')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Sessions' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Questions' })).not.toBeInTheDocument()
  })
})
