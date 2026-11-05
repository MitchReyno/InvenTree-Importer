import { fireEvent, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { render } from '../../test/render'
import { AgentSessions } from './AgentSessions'
import type { AgentSessionListDto } from '@invimport/contracts'

const selection = {
  provider: 'codex',
  authentication: 'subscription',
  model: 'chosen-model',
} as const
const base: AgentSessionListDto['sessions'][number] = {
  attempt_id: 'one',
  batch_id: 'batch',
  job_id: 'job',
  subject_id: 'lot',
  stage: 'reading',
  state: 'queued',
  latest_on_job: true,
  selection,
  settings_revision: '1',
  queued_at: '2026-11-03T01:00:00.000Z',
  started_at: null,
  finished_at: null,
  native_session_id: null,
  actual_model: null,
  progress: 'queued',
  occupies_lane: false,
  session_state: null,
  latest_status: null,
}

test('session filters keep a cancelled but physically occupied command active until reap', async () => {
  const sessions = [
    base,
    {
      ...base,
      attempt_id: 'two',
      state: 'cancelled' as const,
      occupies_lane: true,
      selection: { ...selection, model: 'still-running-model' },
    },
    {
      ...base,
      attempt_id: 'three',
      state: 'failed' as const,
      selection: { ...selection, model: 'finished-model' },
    },
  ]
  const client = {
    sessions: vi.fn(async () => ({ sessions, next_before: null })),
    settings: vi.fn(),
    saveSettings: vi.fn(),
  }
  render(<AgentSessions client={client} />)
  await screen.findByText('Codex · chosen-model')
  fireEvent.click(screen.getByRole('button', { name: 'Active' }))
  expect(screen.getByText('Codex · still-running-model')).toBeVisible()
  expect(screen.queryByText('Codex · finished-model')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Completed' }))
  expect(screen.getByText('Codex · finished-model')).toBeVisible()
  expect(screen.queryByText('Codex · still-running-model')).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Open batch processing and controls' })).toHaveAttribute(
    'href',
    '#batch/processing/reading',
  )
})

test('history failure is visible and does not start a session or hide it as a successful empty queue', async () => {
  const client = {
    sessions: vi.fn().mockRejectedValue(new Error('offline')),
    settings: vi.fn(),
    saveSettings: vi.fn(),
  }
  render(<AgentSessions client={client} />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Session connection unavailable')
  expect(screen.queryByText('No sessions on this page.')).not.toBeInTheDocument()
  expect(client.saveSettings).not.toHaveBeenCalled()
})
