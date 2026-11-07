import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { render } from '../../test/render'
import { AgentSessions } from './AgentSessions'
import type { AgentSessionListDto, SessionFailureDto } from '@invimport/contracts'

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
    // Local times, so "today" holds in every timezone.
    finished_at: new Date(2026, 10, 6, 8).toISOString(),
  },
  {
    ...base,
    attempt_id: 'finished-yesterday',
    state: 'ready',
    session_state: 'finished',
    finished_at: new Date(2026, 10, 5, 8).toISOString(),
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
  vi.setSystemTime(new Date(2026, 10, 6, 12))
})

afterEach(() => {
  vi.useRealTimers()
})

test('the summary counts slots against the limit, the model and the sessions waiting for you', async () => {
  render(<AgentSessions client={client()} batches={batches} />)
  const summary = await screen.findByRole('region', { name: 'Summary' })

  expect(await within(summary).findByText(/^2 of 3 slots in use/)).toBeInTheDocument()
  expect(within(summary).getByText('1 waiting for you')).toBeInTheDocument()
  expect(within(summary).getByText('Codex · chosen-model')).toBeInTheDocument()
})

test('waiting sessions do not count as running: 3 of 3 slots, 2 waiting, each holding no slot', async () => {
  const running = (id: string): Session => ({
    ...base,
    attempt_id: id,
    state: 'running',
    occupies_lane: true,
    session_state: 'running',
  })

  const waiting = (id: string): Session => ({
    ...base,
    attempt_id: id,
    state: 'waiting_for_user',
    occupies_lane: false,
    session_state: 'waiting_input',
  })

  render(
    <AgentSessions
      client={client({
        sessions: [running('r1'), running('r2'), running('r3'), waiting('w1'), waiting('w2')],
      })}
      batches={batches}
    />,
  )
  const summary = await screen.findByRole('region', { name: 'Summary' })

  expect(await within(summary).findByText(/^3 of 3 slots in use/)).toBeInTheDocument()
  expect(within(summary).getByText('2 waiting for you')).toBeInTheDocument()
  expect(screen.getAllByText(/holds no slot/)).toHaveLength(2)
  // The batch's own heading says how many of its sessions wait for an answer.
  const group = await screen.findByRole('region', { name: 'Mouser order' })
  expect(within(group).getByText('2 need you')).toBeInTheDocument()
})

test('filters show running, waiting, queued and finished-today sessions', async () => {
  render(<AgentSessions client={client()} batches={batches} />)
  await screen.findByText(/^Checking the supplier page/)

  // Each session is a body row of its batch's table; the header row is not counted.
  const sessionRows = () =>
    screen.getAllByRole('row').filter((row) => within(row).queryAllByRole('cell').length > 0)

  fireEvent.click(screen.getByRole('button', { name: /^Running/ }))
  expect(sessionRows()).toHaveLength(2)

  fireEvent.click(screen.getByRole('button', { name: /^Waiting for you/ }))
  expect(sessionRows()).toHaveLength(1)
  expect(sessionRows()[0]).toHaveTextContent(/Examine\s*Whole batch/)

  fireEvent.click(screen.getByRole('button', { name: /^Queued/ }))
  expect(sessionRows()).toHaveLength(1)

  fireEvent.click(screen.getByRole('button', { name: /^Finished today/ }))
  expect(sessionRows()).toHaveLength(1)
  expect(screen.queryByText('Old work')).not.toBeInTheDocument()
})

test('sessions are grouped by batch, each group linking to its Processing', async () => {
  render(<AgentSessions client={client()} batches={batches} />)
  const group = await screen.findByRole('region', { name: 'Mouser order' })

  expect(within(group).getByRole('link', { name: 'Open Processing' })).toHaveAttribute(
    'href',
    '#batch-a/processing/overview',
  )
  const table = within(group).getByRole('table')
  expect(
    within(table)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent),
  ).toEqual(['Step', 'Lot', 'Latest status', 'State', 'Since'])
  const row = within(table)
    .getAllByRole('row')
    .find((r) => r.textContent?.includes('Checking the supplier page'))!
  expect(within(row).getByText('Research')).toBeInTheDocument()
  expect(within(row).getByText('Packet A')).toBeInTheDocument()
  // Times are short and tabular.
  expect(within(row).getByText(/^\d{2}:\d{2}$/)).toBeInTheDocument()
  expect(await screen.findByRole('region', { name: 'Bench bag' })).toBeInTheDocument()
})

test('a setup without agent sessions says the server profile runs none', async () => {
  render(
    <AgentSessions
      client={client({ sessions: [], sessions_supported: false })}
      batches={batches}
    />,
  )

  expect(await screen.findByText(/Agent sessions are not available for this setup/)).toBeVisible()
  expect(screen.getByText(/server's processing profile does not run agent sessions/)).toBeVisible()
  expect(screen.queryByRole('link', { name: 'Agent settings' })).not.toBeInTheDocument()
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

test('a failed session opens its retained diagnostics from its row without sending anything', async () => {
  const failed: Session = {
    ...base,
    attempt_id: 'failed-one',
    state: 'failed',
    session_state: 'failed',
    finished_at: new Date(2026, 10, 6, 11).toISOString(),
    latest_status: { text: 'Stopped on a refused tool', at: '2026-11-06T00:30:00.000Z' },
    failure: {
      id: 'failure',
      category: 'tool_policy',
      summary: 'An operation was refused.',
      details_available: true,
    },
  }
  const api = { ...client({ sessions: [failed] }), failure: vi.fn(async () => failureDetails) }
  render(<AgentSessions client={api} batches={batches} />)
  const group = await screen.findByRole('region', { name: 'Mouser order' })
  const row = within(group)
    .getAllByRole('row')
    .find((r) => r.textContent?.includes('Stopped on a refused tool'))!

  expect(within(row).getByText('Tool policy')).toBeInTheDocument()
  fireEvent.click(within(row).getByRole('button', { name: 'Show details' }))
  await waitFor(() => expect(api.failure).toHaveBeenCalledWith('failed-one', 'failure'))
  expect(api.sessions).toHaveBeenCalledOnce()
})

const failureDetails: SessionFailureDto = {
  id: 'failure',
  category: 'tool_policy',
  summary: 'An operation was refused.',
  details_available: true,
  attempt_id: 'failed-one',
  lineage_id: 'lineage',
  turn: '2',
  timestamp: '2026-11-06T00:30:00Z',
  correlation_id: 'correlation',
  code: 'agent_tool_refused',
  stage: 'turn',
  provider: 'codex',
  model: null,
  cli_version: null,
  provider_session_id: null,
  causes: [],
  recovery: 'Check CLI configuration.',
  truncated: false,
}
