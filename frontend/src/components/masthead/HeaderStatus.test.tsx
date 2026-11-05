import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import type { ConnectionStatusDto, HeaderWorkDto } from '@invimport/contracts'
import { render, fixtureScope } from '../../test/render'
import { ServerStateProvider } from '../query/ServerStateProvider'
import { HeaderStatus } from './HeaderStatus'
import { UpdateHealthContext } from '../operations/LiveUpdates'
import type { HeaderClient } from '../../header/types'

const scope = {
  actor_id: fixtureScope.actorId,
  target_id: fixtureScope.targetId,
  target_context_id: fixtureScope.targetContextId,
}
const batchId = '10000000-0000-4000-8000-000000000001'
const id = '20000000-0000-4000-8000-000000000002'

function connection(): ConnectionStatusDto {
  return {
    ...scope,
    target: {
      state: 'unavailable',
      freshness: 'fresh',
      observed_at: new Date().toISOString(),
      failure_code: 'timeout',
      navigation_url: 'https://inventory.example.test/',
      label: 'Bench target',
    },
  }
}

function work(): HeaderWorkDto {
  return {
    ...scope,
    observed_at: new Date().toISOString(),
    work: [],
    active_sessions: [],
    work_truncated: false,
    sessions_truncated: false,
    lane_occupied: false,
  }
}

function client(): HeaderClient {
  return { connection: vi.fn(async () => connection()), work: vi.fn(async () => work()) }
}

afterEach(() => vi.useRealTimers())

test('healthy live transport never implies target reachability and the isolated link follows the connection control', async () => {
  const user = userEvent.setup()
  render(
    <UpdateHealthContext.Provider
      value={{ state: 'live', observedAt: Date.now(), truncated: false }}
    >
      <HeaderStatus client={client()} batchId={batchId} />
    </UpdateHealthContext.Provider>,
  )
  await screen.findByText('InvenTree unavailable')
  const trigger = screen.getByRole('button', { name: 'Connection status' })
  const link = screen.getByRole('link', { name: 'Open InvenTree' })
  expect(link).toHaveAttribute('href', 'https://inventory.example.test/')
  expect(link).toHaveAttribute('target', '_blank')
  expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  expect(trigger.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  await user.click(trigger)
  expect(screen.getByRole('dialog', { name: 'Connection details' })).toHaveTextContent(
    'Live updates connected',
  )
  expect(screen.getByText(/Fresh target observation/)).toBeVisible()
  expect(screen.getByText(/timeout/)).toBeVisible()
})

test('failed activity reads stay unavailable and a missing target URL has no invented link', async () => {
  const api = client()
  vi.mocked(api.work).mockRejectedValue(new Error('offline'))
  vi.mocked(api.connection).mockResolvedValue({
    ...connection(),
    target: {
      ...connection().target,
      state: 'unconfigured',
      observed_at: null,
      freshness: 'unobserved',
      navigation_url: null,
    },
  })
  render(<HeaderStatus client={api} batchId={batchId} />)
  await screen.findByText('Workflow unavailable')
  expect(screen.queryByText('Idle')).toBeNull()
  expect(screen.queryByRole('link', { name: 'Open InvenTree' })).toBeNull()
  expect(screen.getByText(/Open InvenTree unavailable/)).toBeVisible()
})

test('local expiry and visibility recomputation mark an old successful observation stale', async () => {
  const user = userEvent.setup()
  const api = client()
  const old = new Date(Date.now() - 61_000).toISOString()
  vi.mocked(api.connection).mockResolvedValue({
    ...connection(),
    target: { ...connection().target, state: 'reachable', observed_at: old },
  })
  render(<HeaderStatus client={api} />)
  await screen.findByText('InvenTree status stale')
  await user.click(screen.getByRole('button', { name: 'Connection status' }))
  expect(screen.getByText(/Last target check/)).toHaveTextContent(new Date(old).toLocaleString())
  fireEvent(document, new Event('visibilitychange'))
  await waitFor(() => expect(api.connection).toHaveBeenCalledTimes(2))
})

test('current batch work, retained steps and logically cancelled occupied agents remain visible with partial coverage', async () => {
  const user = userEvent.setup()
  const api = client()
  vi.mocked(api.work).mockResolvedValue({
    ...work(),
    work: [
      {
        kind: 'processing',
        id,
        batch_id: batchId,
        attempt_id: id,
        stage: 'research',
        state: 'running',
        input_current: true,
        occupies_lane: true,
        blocked_code: null,
        steps: [{ stage: 'research', state: 'running' }],
        steps_complete: false,
      },
    ],
    active_sessions: [
      {
        attempt_id: id,
        batch_id: batchId,
        job_id: id,
        stage: 'research',
        state: 'cancelled',
        selection: { provider: 'codex', authentication: 'subscription', model: 'fixture-model' },
        actual_model: null,
        progress: 'responding',
        occupies_lane: true,
      },
    ],
    work_truncated: true,
    sessions_truncated: true,
    lane_occupied: true,
  })
  render(
    <>
      <input aria-label="Neighbour draft" defaultValue="Keep this exact input" />
      <HeaderStatus client={api} batchId={batchId} />
    </>,
  )
  await screen.findByText(/Processing in progress/)
  await user.click(screen.getByRole('button', { name: 'Workflow activity' }))
  const panel = screen.getByRole('dialog', { name: 'Workflow details' })
  expect(panel).toHaveTextContent('Current batch')
  expect(panel).toHaveTextContent('cancelled')
  expect(panel).toHaveTextContent('Physical lane occupied')
  expect(panel).toHaveTextContent('Fine-grained step coverage is incomplete')
  expect(panel).toHaveTextContent('Active-session coverage is partial')
  expect(screen.queryByText('No active agents')).toBeNull()
  expect(screen.getByRole('link', { name: 'Agent sessions' })).toHaveAttribute('href', '#agents')
  await user.keyboard('{Escape}')
  expect(screen.getByRole('textbox', { name: 'Neighbour draft' })).toHaveValue(
    'Keep this exact input',
  )
  expect(screen.getByRole('button', { name: 'Workflow activity' })).toHaveFocus()
})

test('scope-mismatched responses cannot supply a target URL or an idle claim', async () => {
  const api = client()
  vi.mocked(api.connection).mockResolvedValue({ ...connection(), target_context_id: id })
  vi.mocked(api.work).mockResolvedValue({ ...work(), target_context_id: id })
  render(<HeaderStatus client={api} />)
  await screen.findByText('Workflow unavailable')
  expect(screen.queryByRole('link', { name: 'Open InvenTree' })).toBeNull()
  expect(screen.queryByText('Idle')).toBeNull()
})

test('healthy sockets retain foreground target polling and local expiry while a later read is pending', async () => {
  vi.useFakeTimers()
  const api = client()
  const initial = {
    ...connection(),
    target: { ...connection().target, state: 'reachable' as const },
  }
  vi.mocked(api.connection)
    .mockResolvedValueOnce(initial)
    .mockImplementation(() => new Promise(() => undefined))
  render(
    <UpdateHealthContext.Provider
      value={{ state: 'live', observedAt: Date.now(), truncated: false }}
    >
      <HeaderStatus client={api} />
    </UpdateHealthContext.Provider>,
  )
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1)
  })
  const connectedLabel = screen.getByText('inventory.example.test')
  expect(connectedLabel).toBeVisible()
  expect(connectedLabel.previousElementSibling).toHaveAttribute('data-tone', 'ok')
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_100)
  })
  expect(api.connection).toHaveBeenCalledTimes(2)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_100)
  })
  const staleLabel = screen.getByText('InvenTree status stale')
  expect(staleLabel).toBeVisible()
  expect(staleLabel.previousElementSibling).toHaveAttribute('data-tone', 'warn')
})

test('tab-level rerenders preserve the draft and the same scoped query subscriptions', async () => {
  const user = userEvent.setup()
  const api = client()

  const element = (tab: string) => (
    <>
      <input aria-label="Unsaved draft" defaultValue="Original" />
      <span>{tab}</span>
      <HeaderStatus client={api} batchId={batchId} />
    </>
  )

  const view = render(element('Capture'))
  await screen.findByText('InvenTree unavailable')
  const draft = screen.getByRole('textbox', { name: 'Unsaved draft' })
  await user.type(draft, ' plus unsaved input')
  view.rerender(element('Review'))
  expect(screen.getByRole('textbox', { name: 'Unsaved draft' })).toBe(draft)
  expect(draft).toHaveValue('Original plus unsaved input')
  expect(api.connection).toHaveBeenCalledOnce()
  expect(api.work).toHaveBeenCalledOnce()
})

test('workflow retains original-run navigation and shared observers deduplicate reads', async () => {
  const user = userEvent.setup()
  const api = client()
  vi.mocked(api.work).mockResolvedValue({
    ...work(),
    work: [
      {
        kind: 'import',
        id,
        batch_id: batchId,
        stage: 'inventory',
        state: 'recovery_required',
        steps: [
          { name: 'approval', state: 'confirmed' },
          { name: 'inventory', state: 'unknown' },
        ],
        steps_complete: false,
      },
    ],
  })
  render(
    <>
      <HeaderStatus client={api} />
      <HeaderStatus client={api} />
    </>,
  )
  await screen.findAllByText(/Needs attention/)
  expect(api.connection).toHaveBeenCalledOnce()
  expect(api.work).toHaveBeenCalledOnce()
  await user.click(screen.getAllByRole('button', { name: 'Workflow activity' })[0])
  expect(screen.getByRole('link', { name: 'Open original run' })).toHaveAttribute(
    'href',
    `#${batchId}/results/${id}`,
  )
  expect(screen.queryByRole('button', { name: /retry|resume|apply|cancel/i })).toBeNull()
})

test('a late previous-context response cannot replace the current scoped header', async () => {
  const oldApi = client()

  let resolveOld: (value: ConnectionStatusDto) => void = () => {
    throw new Error('old_read_not_started')
  }

  vi.mocked(oldApi.connection).mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveOld = resolve
      }),
  )
  const nextScope = { ...fixtureScope, targetContextId: id }
  const nextApi = client()
  vi.mocked(nextApi.connection).mockResolvedValue({
    ...connection(),
    target_context_id: id,
    target: { ...connection().target, navigation_url: 'https://new-target.example.test/' },
  })
  vi.mocked(nextApi.work).mockResolvedValue({ ...work(), target_context_id: id })
  const view = render(
    <ServerStateProvider key="old" scope={fixtureScope}>
      <HeaderStatus client={oldApi} />
    </ServerStateProvider>,
  )
  await waitFor(() => expect(oldApi.connection).toHaveBeenCalledOnce())
  view.rerender(
    <ServerStateProvider key="new" scope={nextScope}>
      <HeaderStatus client={nextApi} />
    </ServerStateProvider>,
  )
  await waitFor(() =>
    expect(screen.getByRole('link', { name: 'Open InvenTree' })).toHaveAttribute(
      'href',
      'https://new-target.example.test/',
    ),
  )
  await act(async () => {
    resolveOld(connection())
  })
  expect(screen.getByRole('link', { name: 'Open InvenTree' })).toHaveAttribute(
    'href',
    'https://new-target.example.test/',
  )
})

test('current-batch work takes priority over another running batch without losing the global details', async () => {
  const api = client()
  const other = '30000000-0000-4000-8000-000000000003'
  const processing = {
    kind: 'processing' as const,
    id,
    batch_id: other,
    attempt_id: id,
    stage: 'images' as const,
    state: 'running' as const,
    input_current: true,
    occupies_lane: true,
    blocked_code: null,
    steps: [{ stage: 'images' as const, state: 'running' as const }],
    steps_complete: false,
  }
  vi.mocked(api.work).mockResolvedValue({
    ...work(),
    work: [
      processing,
      {
        ...processing,
        id: other,
        batch_id: batchId,
        attempt_id: other,
        stage: 'research',
        state: 'waiting_for_user',
        occupies_lane: false,
        steps: [{ stage: 'research', state: 'waiting_for_user' }],
      },
    ],
  })
  render(<HeaderStatus client={api} batchId={batchId} />)
  await screen.findByText('Needs attention · research')
  await userEvent.setup().click(screen.getByRole('button', { name: 'Workflow activity' }))
  expect(screen.getByRole('dialog')).toHaveTextContent('images · running')
  expect(screen.getByRole('dialog')).toHaveTextContent('research · waiting for user')
})

test('foreground clock reconciliation cannot report an old live transport as connected', async () => {
  vi.useFakeTimers()
  const observedAt = Date.now()
  const api = client()
  render(
    <UpdateHealthContext.Provider value={{ state: 'live', observedAt, truncated: false }}>
      <HeaderStatus client={api} />
    </UpdateHealthContext.Provider>,
  )
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1)
  })
  fireEvent.click(screen.getByRole('button', { name: 'Connection status' }))
  expect(screen.getByText('Live updates connected')).toBeVisible()
  vi.setSystemTime(observedAt + 31_000)
  await act(async () => {
    fireEvent.focus(window)
    await vi.advanceTimersByTimeAsync(1)
  })
  expect(screen.queryByText('Live updates connected')).toBeNull()
  expect(screen.getByText(/Live-update observation stale/)).toBeVisible()
  expect(screen.getByText('Application API read available')).toBeVisible()
  expect(screen.getByText(/Fresh target observation/)).toBeVisible()
})

test('live transport without a retained frame observation remains unknown', async () => {
  render(
    <UpdateHealthContext.Provider value={{ state: 'live', observedAt: null, truncated: false }}>
      <HeaderStatus client={client()} />
    </UpdateHealthContext.Provider>,
  )
  await screen.findByText('InvenTree unavailable')
  await userEvent.setup().click(screen.getByRole('button', { name: 'Connection status' }))
  expect(screen.getByText(/Live-update health unknown/)).toBeVisible()
  expect(screen.queryByText('Live updates connected')).toBeNull()
})
