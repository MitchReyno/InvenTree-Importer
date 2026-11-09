import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useQuery } from '@tanstack/react-query'
import { afterEach, expect, test, vi } from 'vitest'
import type { BatchAttentionDto, ConnectionStatusDto, HeaderWorkDto } from '@invimport/contracts'
import { render, fixtureScope } from '#/test/render'
import { serverQueryKey } from '#/queries/scope'
import { ServerStateProvider } from '#/components/query/ServerStateProvider'
import { HeaderStatus } from './HeaderStatus'
import { UpdateHealthContext } from '#/components/operations/LiveUpdates'
import type { HeaderClient } from '#/header/types'

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

/** Diagnostics sit in a panel's Details disclosure. */
function showDetails(panel: HTMLElement) {
  for (const details of panel.querySelectorAll('details')) {
    details.open = true
  }
}

const SHORT_TIME: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' }

test('healthy live transport never implies target reachability and Open InvenTree sits only in the server menu', async () => {
  const user = userEvent.setup()
  render(
    <UpdateHealthContext.Provider
      value={{ state: 'live', observedAt: Date.now(), truncated: false }}
    >
      <HeaderStatus client={client()} batchId={batchId} />
    </UpdateHealthContext.Provider>,
  )
  await screen.findByText('InvenTree unreachable')
  const trigger = screen.getByRole('button', { name: 'Connection status' })
  // The bar has no separate Open InvenTree button.
  expect(screen.queryByRole('link', { name: 'Open InvenTree' })).toBeNull()
  await user.click(trigger)
  const panel = screen.getByRole('dialog', { name: 'Connection details' })
  const link = within(panel).getByRole('link', { name: 'Open InvenTree' })
  expect(link).toHaveAttribute('href', 'https://inventory.example.test/')
  expect(link).toHaveAttribute('target', '_blank')
  expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  showDetails(panel)
  expect(panel).toHaveTextContent('Live updates connected')
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
  const user = userEvent.setup()
  render(<HeaderStatus client={api} batchId={batchId} />)
  await screen.findByText('Workflow unavailable')
  expect(screen.queryByText('Idle')).toBeNull()
  // At phone width a short drawn word keeps the control from going blank.
  expect(
    screen.getByRole('button', { name: 'Workflow activity' }).querySelector('[data-short]'),
  ).toHaveAttribute('data-short', 'Offline')
  await user.click(screen.getByRole('button', { name: 'Connection status' }))
  const panel = screen.getByRole('dialog', { name: 'Connection details' })
  expect(within(panel).queryByRole('link', { name: 'Open InvenTree' })).toBeNull()
  expect(within(panel).getByText(/Open InvenTree unavailable/)).toBeVisible()
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
  expect(screen.getByRole('dialog', { name: 'Connection details' })).toHaveTextContent(
    `Last check${new Date(old).toLocaleTimeString([], SHORT_TIME)}`,
  )
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
        session_state: null,
        latest_status: null,
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
  // The cancelled session still holds a slot, and the session list is partial.
  await screen.findByText('1+ agents working')
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
  const user = userEvent.setup()
  render(<HeaderStatus client={api} />)
  await screen.findByText('Workflow unavailable')
  await user.click(screen.getByRole('button', { name: 'Connection status' }))
  expect(screen.getByRole('dialog', { name: 'Connection details' })).toHaveTextContent(
    'Open InvenTree unavailable',
  )
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
  // At phone width the full text stays for assistive tech; only a short word is drawn.
  expect(connectedLabel).toHaveAttribute('data-compact', 'visually-hidden')
  expect(connectedLabel.nextElementSibling).toHaveAttribute('aria-hidden', 'true')
  expect(connectedLabel.nextElementSibling).toHaveAttribute('data-short', 'inventory.example.test')
  expect(
    screen.getByRole('button', { name: 'Workflow activity' }).querySelector('[data-compact]'),
  ).toHaveAttribute('data-compact', 'visually-hidden')
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
  await screen.findByText('InvenTree unreachable')
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
    `#${batchId}/changes/added/${id}`,
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
  await waitFor(() => expect(nextApi.connection).toHaveBeenCalled())
  fireEvent.click(screen.getByRole('button', { name: 'Connection status' }))
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
  showDetails(screen.getByRole('dialog', { name: 'Connection details' }))
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
  await screen.findByText('InvenTree unreachable')
  await userEvent.setup().click(screen.getByRole('button', { name: 'Connection status' }))
  showDetails(screen.getByRole('dialog', { name: 'Connection details' }))
  expect(screen.getByText(/Live-update health unknown/)).toBeVisible()
  expect(screen.queryByText('Live updates connected')).toBeNull()
})

test('a session shows its latest status line, and a waiting session holds no slot', async () => {
  const user = userEvent.setup()
  const api = client()
  const row = {
    batch_id: batchId,
    stage: 'research' as const,
    selection: {
      provider: 'claude' as const,
      authentication: 'subscription' as const,
      model: 'sonnet',
    },
    actual_model: 'claude-sonnet-5-5',
    progress: 'responding' as const,
  }
  vi.mocked(api.work).mockResolvedValue({
    ...work(),
    active_sessions: [
      {
        ...row,
        attempt_id: id,
        job_id: id,
        state: 'running',
        occupies_lane: true,
        session_state: 'running',
        latest_status: {
          text: 'Comparing markings with datasheet candidates',
          at: '2026-11-06T01:02:03.000Z',
        },
      },
      {
        ...row,
        attempt_id: 'f0000000-0000-4000-8000-00000000000f',
        job_id: 'f0000000-0000-4000-8000-00000000000f',
        state: 'waiting_for_user',
        occupies_lane: false,
        session_state: 'waiting_input',
        latest_status: { text: 'Asked how many reels there are', at: '2026-11-06T01:03:00.000Z' },
      },
    ],
  })
  render(<HeaderStatus client={api} batchId={batchId} />)
  await user.click(await screen.findByRole('button', { name: 'Workflow activity' }))
  const panel = screen.getByRole('dialog', { name: 'Workflow details' })
  expect(panel).toHaveTextContent('Comparing markings with datasheet candidates')
  expect(panel).toHaveTextContent('Physical lane occupied')
  expect(panel).toHaveTextContent('Asked how many reels there are')
  expect(panel).toHaveTextContent('Waiting for your input · holds no slot')
  // Each session's own status keeps its time, not only the newest one.
  for (const at of ['2026-11-06T01:02:03.000Z', '2026-11-06T01:03:00.000Z']) {
    expect(panel.querySelector(`time[datetime="${at}"]`)).not.toBeNull()
  }
})

test('the server menu holds the dev badge, a disabled connection check, server settings and the theme', async () => {
  const user = userEvent.setup()
  render(<HeaderStatus client={client()} batchId={batchId} />)
  await screen.findByText('InvenTree unreachable')
  await user.click(screen.getByRole('button', { name: 'Connection status' }))
  const panel = screen.getByRole('dialog', { name: 'Connection details' })

  expect(within(panel).getByText('Dev mode')).toBeVisible()
  const check = within(panel).getByRole('button', { name: 'Check connection now' })
  expect(check).toHaveAttribute('aria-disabled', 'true')
  expect(check).toHaveAccessibleDescription(/not available yet/i)
  expect(within(panel).getByRole('link', { name: 'Server settings' })).toHaveAttribute(
    'href',
    '#settings/inventree',
  )
  const theme = within(panel).getByRole('radiogroup', { name: 'Theme' })
  await user.click(within(theme).getByRole('radio', { name: 'Dark' }))
  expect(document.documentElement.dataset.theme).toBe('dark')
  await user.click(within(theme).getByRole('radio', { name: 'System' }))

  await user.keyboard('{Escape}')
  expect(screen.queryByRole('dialog', { name: 'Connection details' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Connection status' })).toHaveFocus()
})

test('the bar ends with activity, connection and the Settings button', async () => {
  render(<HeaderStatus client={client()} batchId={batchId} />)
  await screen.findByText('InvenTree unreachable')
  const order = [
    screen.getByRole('button', { name: 'Workflow activity' }),
    screen.getByRole('button', { name: 'Connection status' }),
    screen.getByRole('link', { name: 'Settings' }),
  ]

  expect(order[2]).toHaveAttribute('href', '#settings')
  order
    .slice(1)
    .forEach((element, index) =>
      expect(
        order[index].compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy(),
    )
})

const stepCounts = { questions: 0, failed: 0, jobs: 0, ready: 0, running: 0 }

/** Stands in for the batch screen, which fills the capture and attention reads the header shares. */
function BatchReads({ attention }: { attention: BatchAttentionDto }) {
  useQuery({
    queryKey: serverQueryKey(fixtureScope, 'capture', batchId),
    queryFn: async () => ({ id: batchId, title: 'Mouser 3381-22 + bench bag', revision: '4' }),
  })
  useQuery({
    queryKey: serverQueryKey(fixtureScope, 'attention', batchId, '4'),
    queryFn: async () => attention,
  })
  return null
}

function processingWork(): HeaderWorkDto {
  const session = {
    batch_id: batchId,
    stage: 'research' as const,
    state: 'running' as const,
    selection: null,
    actual_model: null,
    progress: 'responding' as const,
    session_state: 'running' as const,
    latest_status: null,
  }
  return {
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
        steps: [
          { stage: 'examine', state: 'ready' },
          { stage: 'research', state: 'running' },
          { stage: 'images', state: 'failed' },
          { stage: 'inventory', state: 'queued' },
        ],
        steps_complete: true,
      },
    ],
    active_sessions: [
      { ...session, attempt_id: id, job_id: id, occupies_lane: true },
      {
        ...session,
        attempt_id: 'f0000000-0000-4000-8000-00000000000f',
        job_id: 'f0000000-0000-4000-8000-00000000000f',
        occupies_lane: true,
      },
      {
        ...session,
        attempt_id: 'e0000000-0000-4000-8000-00000000000e',
        job_id: 'e0000000-0000-4000-8000-00000000000e',
        occupies_lane: false,
        session_state: 'waiting_input' as const,
      },
    ],
    lane_occupied: true,
  }
}

const attention: BatchAttentionDto = {
  batch_id: batchId,
  revision: '4',
  processing: {
    questions: 3,
    failed: 1,
    running: 2,
    steps: {
      examine: { ...stepCounts, jobs: 4, ready: 4 },
      research: { ...stepCounts, jobs: 10, ready: 6, running: 2 },
      images: { ...stepCounts, failed: 1, jobs: 2 },
      inventory: stepCounts,
    },
  },
  review: { to_check: 0, changed_after_review: 0, to_decide: 0, records: 0 },
  changes: { ready: 0, failed: 0, uncertain: 0, runs: 0 },
  items: [],
  items_truncated: false,
}

test('inside its batch the activity label counts the agents holding a slot, with no batch name or question count', async () => {
  const api = client()
  vi.mocked(api.work).mockResolvedValue(processingWork())
  render(
    <>
      <BatchReads attention={attention} />
      <HeaderStatus client={api} batchId={batchId} />
    </>,
  )

  expect(await screen.findByText('2 agents working')).toBeInTheDocument()
  const trigger = screen.getByRole('button', { name: 'Workflow activity' })
  await waitFor(() =>
    expect(trigger).toHaveAccessibleDescription('2 agents working Research: 6 of 10'),
  )
  expect(trigger).not.toHaveTextContent('Mouser 3381-22')
  expect(trigger).not.toHaveTextContent('3')
  // The AI mark leads a working chip.
  expect(trigger.querySelector('[data-ai-mark]')).not.toBeNull()
  const steps = within(trigger).getAllByRole('listitem', { hidden: true })
  expect(steps.map((step) => step.textContent)).toEqual([
    'Examine: done',
    'Research: running',
    'Images: failed',
    'Inventory: waiting',
  ])
})

test('away from the batch the header step counts give the partial fill and "Research: 3 of 5"', async () => {
  const user = userEvent.setup()
  const api = client()
  const step = { jobs: 0, ready: 0, running: 0 }
  vi.mocked(api.work).mockResolvedValue({
    ...processingWork(),
    batch_steps: [
      {
        batch_id: batchId,
        steps: {
          examine: { ...step, jobs: 4, ready: 4 },
          research: { jobs: 5, ready: 3, running: 1 },
          images: step,
          inventory: step,
        },
      },
    ],
  })
  render(<HeaderStatus client={api} />)

  const trigger = await screen.findByRole('button', { name: 'Workflow activity' })
  await waitFor(() => expect(trigger).toHaveAccessibleDescription(/Research: 3 of 5/))
  const running = trigger.querySelector('[data-state="running"] i')
  expect(running).toHaveStyle({ width: '60%' })

  await user.click(trigger)
  const panel = screen.getByRole('dialog', { name: 'Workflow details' })
  const job = within(panel).getByRole('region', { name: 'Other batch · Processing' })
  expect(job.querySelector('[data-state="running"] i')).toHaveStyle({ width: '60%' })
})

test('a batch the header read does not count shows its running step without a fraction', async () => {
  const api = client()
  vi.mocked(api.work).mockResolvedValue({ ...processingWork(), batch_steps: [] })
  render(<HeaderStatus client={api} />)

  const trigger = await screen.findByRole('button', { name: 'Workflow activity' })
  await screen.findByText('2 agents working')
  expect(trigger).not.toHaveAccessibleDescription(/ of /)
})

test('without the batch reads the label still names the work and leaves out the question count', async () => {
  const api = client()
  vi.mocked(api.work).mockResolvedValue(processingWork())
  render(<HeaderStatus client={api} batchId={batchId} />)

  expect(await screen.findByText('2 agents working')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Workflow activity' })).toHaveAccessibleDescription(
    '2 agents working',
  )
})

test('the workflow panel shows each job as step segments and keeps raw IDs out of its text', async () => {
  const user = userEvent.setup()
  const api = client()
  vi.mocked(api.work).mockResolvedValue(processingWork())
  render(<HeaderStatus client={api} batchId={batchId} />)
  await user.click(await screen.findByRole('button', { name: 'Workflow activity' }))
  const panel = screen.getByRole('dialog', { name: 'Workflow details' })

  expect(within(panel).queryByRole('button', { name: /Close/ })).toBeNull()
  expect(within(panel).queryByRole('list', { name: 'Retained steps' })).toBeNull()
  const job = within(panel).getByRole('region', { name: 'Current batch · Processing' })
  expect(within(job).getByText('Research: running')).toBeInTheDocument()
  expect(within(job).getByText('Running')).toBeInTheDocument()
  expect(within(job).getByRole('link', { name: 'Open processing' })).toBeInTheDocument()
  const details = within(job).getByText('Details').closest('details')!
  expect(details).not.toHaveAttribute('open')
  expect(details).toHaveTextContent(`attempt ${id}`)
  expect(details).toHaveTextContent('Physical lane occupied')
  for (const line of within(job).getAllByText(`attempt ${id}`, { exact: false })) {
    expect(line).not.toBeVisible()
  }
})

test('with nothing retained the activity pill says so plainly and drops its accent', async () => {
  render(<HeaderStatus client={client()} batchId={batchId} />)

  expect(await screen.findByText('Idle')).toBeInTheDocument()
  const trigger = screen.getByRole('button', { name: 'Workflow activity' })
  expect(trigger).toHaveAccessibleDescription('Idle Nothing running')
  expect(trigger).toHaveAttribute('data-active', 'false')
  expect(trigger.querySelector('[data-ai-mark]')).toBeNull()
})

test('other open jobs show as +N beside the named one', async () => {
  const api = client()
  const busy = processingWork()
  vi.mocked(api.work).mockResolvedValue({
    ...busy,
    work: [
      ...busy.work,
      {
        kind: 'import',
        id: 'd0000000-0000-4000-8000-00000000000d',
        batch_id: 'c0000000-0000-4000-8000-00000000000c',
        stage: 'inventory',
        state: 'running',
        steps: [{ name: 'approval', state: 'confirmed' }],
        steps_complete: false,
      },
    ],
  })
  render(<HeaderStatus client={api} batchId={batchId} />)

  await screen.findByText('2 agents working')
  expect(screen.getByRole('button', { name: 'Workflow activity' })).toHaveAccessibleDescription(
    '2 agents working 1 more job',
  )
})

test('the connection panel leads with host, last check and Open InvenTree, and names a test target once', async () => {
  const user = userEvent.setup()
  const api = client()
  const at = new Date().toISOString()
  vi.mocked(api.connection).mockResolvedValue({
    ...connection(),
    target: {
      ...connection().target,
      state: 'reachable',
      kind: 'owned_test',
      observed_at: at,
      failure_code: null,
    },
  })
  render(<HeaderStatus client={api} batchId={batchId} />)
  await user.click(await screen.findByRole('button', { name: 'Connection status' }))
  const panel = screen.getByRole('dialog', { name: 'Connection details' })

  expect(panel).toHaveTextContent('Hostinventory.example.test')
  expect(panel).toHaveTextContent(`Last check${new Date(at).toLocaleTimeString([], SHORT_TIME)}`)
  expect(within(panel).getAllByText(/test InvenTree/)).toHaveLength(1)
  expect(within(panel).getByRole('link', { name: 'Open InvenTree' })).toBeVisible()
  expect(within(panel).getByText(/Application API/)).not.toBeVisible()
})

test('the connection panel names the InvenTree version when the check read one, and leaves it out otherwise', async () => {
  const user = userEvent.setup()
  const api = client()
  const at = new Date().toISOString()
  const reachable = { ...connection().target, state: 'reachable' as const, observed_at: at }
  vi.mocked(api.connection).mockResolvedValue({
    ...connection(),
    target: { ...reachable, version: '0.17.10' },
  })
  const view = render(<HeaderStatus client={api} batchId={batchId} />)
  await user.click(await screen.findByRole('button', { name: 'Connection status' }))
  expect(screen.getByRole('dialog', { name: 'Connection details' })).toHaveTextContent(
    'VersionInvenTree 0.17.10',
  )
  view.unmount()

  vi.mocked(api.connection).mockResolvedValue({
    ...connection(),
    target: { ...reachable, version: null },
  })
  render(<HeaderStatus client={api} batchId={batchId} />)
  await user.click(await screen.findByRole('button', { name: 'Connection status' }))
  expect(screen.getByRole('dialog', { name: 'Connection details' })).not.toHaveTextContent(
    'Version',
  )
})

test('at phone width a failed job still draws a word, never an empty pill', async () => {
  const api = client()
  const busy = processingWork()
  vi.mocked(api.work).mockResolvedValue({
    ...busy,
    work: [
      {
        ...busy.work[0],
        state: 'failed',
        occupies_lane: false,
        steps: [{ stage: 'research', state: 'failed' }],
      } as HeaderWorkDto['work'][number],
    ],
    active_sessions: [],
  })
  render(<HeaderStatus client={api} batchId={batchId} />)
  await screen.findByText('Needs attention · research')

  expect(
    screen.getByRole('button', { name: 'Workflow activity' }).querySelector('[data-short]'),
  ).toHaveAttribute('data-short', 'Failed')
})

/** The server's shape: one retained job per step, each with that one step. */
function job(stage: 'examine' | 'research' | 'images' | 'inventory', state: string, n: number) {
  const jobId = `9000000${n}-0000-4000-8000-000000000000`
  return {
    kind: 'processing' as const,
    id: jobId,
    batch_id: batchId,
    attempt_id: jobId,
    stage,
    state,
    input_current: true,
    occupies_lane: state === 'running',
    blocked_code: null,
    steps: [{ stage, state }],
    steps_complete: false,
  } as HeaderWorkDto['work'][number]
}

test('the planned steps come from all of the batch’s jobs, one step each', async () => {
  const api = client()
  vi.mocked(api.work).mockResolvedValue({
    ...work(),
    work: [job('examine', 'ready', 1), job('research', 'running', 2), job('images', 'queued', 3)],
  })
  render(<HeaderStatus client={api} batchId={batchId} />)
  const trigger = await screen.findByRole('button', { name: 'Workflow activity' })

  await waitFor(() =>
    expect(
      within(trigger)
        .getAllByRole('listitem', { hidden: true })
        .map((step) => step.textContent),
    ).toEqual(['Examine: done', 'Research: running', 'Images: waiting', 'Inventory: waiting']),
  )
})

test('an import run keeps its own state, apart from Processing’s questions and agents', async () => {
  const user = userEvent.setup()
  const api = client()
  const busy = processingWork()
  vi.mocked(api.work).mockResolvedValue({
    ...busy,
    work: [
      ...busy.work,
      {
        kind: 'import',
        id: 'd0000000-0000-4000-8000-00000000000d',
        batch_id: batchId,
        stage: 'inventory',
        state: 'recovery_required',
        steps: [{ name: 'approval', state: 'confirmed' }],
        steps_complete: true,
      },
    ],
    active_sessions: busy.active_sessions.map((session) => ({
      ...session,
      latest_status: { text: 'Comparing supplier listings', at: new Date().toISOString() },
    })),
  })
  render(
    <>
      <BatchReads attention={attention} />
      <HeaderStatus client={api} batchId={batchId} />
    </>,
  )
  await user.click(await screen.findByRole('button', { name: 'Workflow activity' }))
  const panel = screen.getByRole('dialog', { name: 'Workflow details' })

  const run = within(panel).getByRole('region', { name: /· Import$/ })
  expect(within(run).getByText('Needs recovery')).toBeInTheDocument()
  expect(run).not.toHaveTextContent('need you')
  expect(run).not.toHaveTextContent('Comparing supplier listings')
  const processing = within(panel).getByRole('region', { name: /· Processing$/ })
  await waitFor(() => expect(within(processing).getByText('3 need you')).toBeInTheDocument())
})

test('at phone width a read that is not current names its state, with no cached count', async () => {
  const api = client()
  vi.mocked(api.work).mockRejectedValue(new Error('offline'))
  render(
    <>
      <BatchReads attention={attention} />
      <HeaderStatus client={api} batchId={batchId} />
    </>,
  )
  await screen.findByText('Workflow unavailable')
  const trigger = screen.getByRole('button', { name: 'Workflow activity' })

  // The pill carries no question count; the batch header owns it.
  await waitFor(() => expect(trigger.querySelector('[data-short]')).not.toBeNull())
  expect(trigger.querySelector('[data-short]')).toHaveAttribute('data-short', 'Offline')
  expect(trigger).not.toHaveTextContent('3')
})

test('a cancelled attempt that still holds its slot says so, on the pill and in the panel', async () => {
  const user = userEvent.setup()
  const api = client()
  vi.mocked(api.work).mockResolvedValue({
    ...work(),
    work: [
      { ...job('research', 'cancelled', 4), occupies_lane: true } as HeaderWorkDto['work'][number],
    ],
    lane_occupied: true,
  })
  render(<HeaderStatus client={api} batchId={batchId} />)
  const trigger = await screen.findByRole('button', { name: 'Workflow activity' })

  await waitFor(() =>
    expect(trigger.querySelector('[data-short]')).toHaveAttribute('data-short', 'Slot held'),
  )
  await user.click(trigger)
  expect(within(screen.getByRole('dialog')).getByText('Cancelled · slot held')).toBeInTheDocument()
})

test('another batch’s cancelled job still holding its slot counts in +N', async () => {
  const api = client()
  vi.mocked(api.work).mockResolvedValue({
    ...work(),
    work: [
      job('research', 'running', 5),
      {
        ...job('images', 'cancelled', 6),
        batch_id: 'c0000000-0000-4000-8000-00000000000c',
        occupies_lane: true,
      } as HeaderWorkDto['work'][number],
    ],
  })
  render(<HeaderStatus client={api} batchId={batchId} />)
  const trigger = await screen.findByRole('button', { name: 'Workflow activity' })

  await waitFor(() => expect(trigger).toHaveAccessibleDescription(/1 more job/))
})

test('on phones a held slot outranks the spinner of a merely queued sibling', async () => {
  const api = client()
  vi.mocked(api.work).mockResolvedValue({
    ...work(),
    work: [
      { ...job('research', 'cancelled', 7), occupies_lane: true } as HeaderWorkDto['work'][number],
      job('images', 'queued', 8),
    ],
    lane_occupied: true,
  })
  render(<HeaderStatus client={api} batchId={batchId} />)
  const trigger = await screen.findByRole('button', { name: 'Workflow activity' })

  await waitFor(() =>
    expect(trigger.querySelector('[data-short]')).toHaveAttribute('data-short', 'Slot held'),
  )
})

test('outside a batch the activity label names the batch it shows, from that batch’s cached read', async () => {
  const api = client()
  vi.mocked(api.work).mockResolvedValue(processingWork())
  render(
    <>
      <BatchReads attention={attention} />
      <HeaderStatus client={api} />
    </>,
  )

  const trigger = await screen.findByRole('button', { name: 'Workflow activity' })
  await waitFor(() =>
    expect(trigger).toHaveAccessibleDescription(/^2 agents working Mouser 3381-22 \+ bench bag/),
  )
})
