import { fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { render } from '../../test/render'
import { AgentSessions } from './AgentSessions'
import type { AgentSessionListDto } from '@invimport/contracts'

const selection = {
  provider: 'codex',
  authentication: 'subscription',
  model: 'chosen-model',
} as const

type Session = AgentSessionListDto['sessions'][number]

const base: Session = {
  attempt_id: 'one',
  batch_id: 'batch-a',
  job_id: 'job',
  subject_id: 'lot',
  stage: 'research',
  state: 'queued',
  latest_on_job: true,
  selection,
  settings_revision: '1',
  queued_at: '2026-11-06T01:00:00.000Z',
  started_at: null,
  finished_at: null,
  native_session_id: null,
  actual_model: null,
  progress: 'queued',
  occupies_lane: false,
  session_state: 'queued',
  latest_status: null,
}

const sessions: Session[] = [
  base,
  {
    ...base,
    attempt_id: 'running',
    state: 'running',
    progress: 'responding',
    occupies_lane: true,
    session_state: 'running',
    started_at: '2026-11-06T02:00:00.000Z',
    latest_status: { text: 'Checking the supplier page', at: '2026-11-06T02:01:00.000Z' },
  },
  {
    ...base,
    attempt_id: 'cancelled-still-running',
    state: 'cancelled',
    occupies_lane: true,
    session_state: 'cancelling',
  },
  {
    ...base,
    attempt_id: 'waiting',
    batch_id: 'batch-b',
    stage: 'examine',
    subject_id: null,
    state: 'waiting_for_user',
    session_state: 'waiting_input',
  },
  {
    ...base,
    attempt_id: 'finished-today',
    state: 'ready',
    session_state: 'finished',
    finished_at: '2026-11-06T03:00:00.000Z',
  },
  {
    ...base,
    attempt_id: 'finished-yesterday',
    state: 'ready',
    session_state: 'finished',
    finished_at: '2026-11-05T03:00:00.000Z',
    latest_status: { text: 'Old work', at: '2026-11-05T03:00:00.000Z' },
  },
]

function client(list: Partial<AgentSessionListDto> = {}) {
  return {
    sessions: vi.fn(async () => ({
      sessions,
      next_before: null,
      sessions_supported: true,
      ...list,
    })),
    settings: vi.fn(async () => ({ revision: '1', selection, session_concurrency: 3 })),
    saveSettings: vi.fn(),
  }
}

const batches = vi.fn(async (id: string) =>
  id === 'batch-a'
    ? { title: 'Mouser order', subjects: new Map([['lot', 'Packet A']]) }
    : { title: 'Bench bag', subjects: new Map<string, string>() },
)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-06T09:00:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

test('the summary counts slots against the limit, the model and the sessions waiting for you', async () => {
  render(<AgentSessions client={client()} batches={batches} />)
  const summary = await screen.findByRole('region', { name: 'Summary' })

  expect(await within(summary).findByText('2 of 3 slots in use')).toBeInTheDocument()
  expect(within(summary).getByText('1 waiting for you')).toBeInTheDocument()
  expect(within(summary).getByText('Codex · chosen-model')).toBeInTheDocument()
})

test('filters show running, waiting, queued and finished-today sessions', async () => {
  render(<AgentSessions client={client()} batches={batches} />)
  await screen.findByText('Checking the supplier page')

  fireEvent.click(screen.getByRole('button', { name: /^Running/ }))
  expect(screen.getAllByRole('listitem', { name: /session/ })).toHaveLength(2)

  fireEvent.click(screen.getByRole('button', { name: /^Waiting for you/ }))
  expect(screen.getAllByRole('listitem', { name: /session/ })).toHaveLength(1)
  expect(screen.getByText('Examine · Whole batch')).toBeVisible()

  fireEvent.click(screen.getByRole('button', { name: /^Queued/ }))
  expect(screen.getAllByRole('listitem', { name: /session/ })).toHaveLength(1)

  fireEvent.click(screen.getByRole('button', { name: /^Finished today/ }))
  expect(screen.getAllByRole('listitem', { name: /session/ })).toHaveLength(1)
  expect(screen.queryByText('Old work')).not.toBeInTheDocument()
})

test('sessions are grouped by batch, each group linking to its Processing', async () => {
  render(<AgentSessions client={client()} batches={batches} />)
  const group = await screen.findByRole('region', { name: 'Mouser order' })

  expect(within(group).getByRole('link', { name: 'Open Processing' })).toHaveAttribute(
    'href',
    '#batch-a/processing/overview',
  )
  expect(within(group).getAllByText('Research · Packet A').length).toBeGreaterThan(0)
  expect(within(group).getByText('Checking the supplier page')).toBeInTheDocument()
  expect(await screen.findByRole('region', { name: 'Bench bag' })).toBeInTheDocument()
})

test('a setup without agent sessions says so and links to Agent settings', async () => {
  render(
    <AgentSessions
      client={client({ sessions: [], sessions_supported: false })}
      batches={batches}
    />,
  )

  expect(await screen.findByText(/Agent sessions are not available for this setup/)).toBeVisible()
  expect(screen.getByRole('link', { name: 'Agent settings' })).toHaveAttribute('href', '#settings')
  expect(screen.queryByText(/Nothing running|0 of 3 slots/)).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /^Running/ })).not.toBeInTheDocument()
})

test('history failure is visible and does not start a session or hide it as a successful empty queue', async () => {
  const failing = {
    sessions: vi.fn().mockRejectedValue(new Error('offline')),
    settings: vi.fn(async () => ({ revision: '1', selection, session_concurrency: 3 })),
    saveSettings: vi.fn(),
  }
  render(<AgentSessions client={failing} batches={batches} />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Session connection unavailable')
  expect(screen.queryByText(/No sessions/)).not.toBeInTheDocument()
  expect(failing.saveSettings).not.toHaveBeenCalled()
})
