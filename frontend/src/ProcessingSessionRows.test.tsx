import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { IntakeRequestError } from '@invimport/contracts/client'
import { expect, test, vi } from 'vitest'
import {
  validate,
  type AgentSessionListDto,
  type AgentSessionQueryDto,
  type CaptureSnapshotDto,
  type ProcessingJobDto,
  type ProcessingSnapshotDto,
  type StartFreshEligibilityDto,
} from '@invimport/contracts'
import { ProcessingWorkspace } from './components/processing/ProcessingWorkspace'
import { ServerStateProvider } from './components/query/ServerStateProvider'
import { createServerQueryClient } from './queries/client'
import type { ServerScope } from './queries/scope'
import type { ProcessingClient, ProcessingView } from './processing/types'
import { ApiClientsProvider } from './context'
import { agentSettings } from '#/test/agent-settings'
import { S, sessionList, sessionRow } from '#/test/agent-sessions'
import { H, attemptHeader, history } from '#/test/session-history'
import { invalidateStartFreshReads } from './processing/start-fresh'
import { deferred } from '#/test/deferred'

const scope: ServerScope = {
  origin: 'http://127.0.0.1:4310',
  actorId: 'a6000000-0000-4000-8000-000000000006',
  targetId: 'a7000000-0000-4000-8000-000000000007',
  targetContextId: 'a8000000-0000-4000-8000-000000000008',
}

const batch: CaptureSnapshotDto = {
  id: H.batch,
  source_id: 'a9000000-0000-4000-8000-000000000009',
  title: 'Heyyy',
  revision: '8',
  archived: false,
  updated_at: '2026-11-02T00:00:00Z',
  actor_id: scope.actorId,
  target_context_id: scope.targetContextId,
  defaults: { quantity: { mode: 'unknown' }, location: { mode: 'clear' } },
  parts: [],
  notes: [],
  observations: [],
  lots: [
    {
      id: H.lot,
      label: 'GE S2CN1 diodes',
      revision: '3',
      contribution_key: 'aa000000-0000-4000-8000-000000000001',
      part_subject_id: null,
      quantity: { mode: 'inherit' },
      location: { mode: 'inherit' },
    },
  ],
  cursor: { stream_id: 'ab000000-0000-4000-8000-000000000002', sequence: '8' },
}

/** A Research session on its third attempt that failed. */
function failedJob(start_fresh: StartFreshEligibilityDto = { allowed: true }): ProcessingJobDto {
  return {
    id: H.job,
    subject_id: H.lot,
    stage: 'research',
    revision: '4',
    state: 'failed',
    attempt_id: H.attempt,
    input_sha256: 'a'.repeat(64),
    attempt_number: '3',
    qualification: 'native_unverified',
    session_state: 'failed',
    start_fresh,
    proposals: [],
    questions: [],
  }
}

function snapshotWith(job: ProcessingJobDto, captureRevision = '8'): ProcessingSnapshotDto {
  const read: ProcessingSnapshotDto = {
    batch_id: H.batch,
    capture_revision: captureRevision,
    runner_status: 'native_unverified',
    cursor: batch.cursor,
    jobs: [job],
  }
  validate('ProcessingSnapshot', read)
  return read
}

const refused = {
  id: H.failure,
  category: 'configuration' as const,
  summary: 'The native session configuration was not accepted.',
  recovery: 'Check the supported CLI version.',
  details_available: false,
  cause: { code: 'agent_admission_unavailable' as const, provider: 'claude' as const },
}

/** The job's history metadata: attempts 1 and 2 failed before the current one. */
function threeAttempts() {
  return history([], {
    attempts: [
      attemptHeader({ id: H.attempt, number: 3, state: 'failed', session_state: 'failed' }),
      attemptHeader({
        id: H.attempt2,
        number: 2,
        state: 'superseded',
        session_state: 'failed',
        ended: { at: '2026-11-24T02:29:00.000Z', source: 'transition' },
        failure: refused,
      }),
      attemptHeader({
        id: 'ac000000-0000-4000-8000-00000000000c',
        number: 1,
        state: 'superseded',
        session_state: 'failed',
        ended: { at: '2026-11-24T01:28:00.000Z', source: 'transition' },
        failure: refused,
      }),
    ],
  })
}

function clients(job: ProcessingJobDto, list = sessionList()) {
  const processing = {
    read: vi.fn().mockResolvedValue(snapshotWith(job)),
    start: vi.fn(),
    cancel: vi.fn(),
    answer: vi.fn(),
    history: vi.fn().mockResolvedValue(threeAttempts()),
    chat: vi.fn(),
    replaceSession: vi
      .fn()
      .mockResolvedValue({ batch_id: H.batch, job_ids: [H.job], attempt_ids: [H.attempt2] }),
  } satisfies ProcessingClient
  const agents = {
    sessions: vi.fn<(query?: AgentSessionQueryDto) => Promise<AgentSessionListDto>>(
      async () => list,
    ),
    settings: vi.fn(async () => agentSettings('1', null)),
  }
  return { processing, agents }
}

function mount(
  { processing, agents }: ReturnType<typeof clients>,
  view: ProcessingView,
  sessionId?: string,
  sessionPageJobId?: string,
) {
  const cache = createServerQueryClient()
  render(
    <ServerStateProvider scope={scope} client={cache}>
      <ApiClientsProvider value={{ agents }}>
        <ProcessingWorkspace
          batch={batch}
          client={processing}
          view={view}
          sessionId={sessionId}
          sessionPageJobId={sessionPageJobId}
          navigate={vi.fn()}
          onDirtyChange={vi.fn()}
          onSaved={vi.fn().mockResolvedValue(undefined)}
        />
      </ApiClientsProvider>
    </ServerStateProvider>,
  )
  return cache
}

test('the overview’s rows and start time come from the batch’s session list, with retries folded', async () => {
  const row = sessionRow({
    attempt_id: H.attempt,
    batch_id: H.batch,
    job_id: H.job,
    subject_id: H.lot,
    state: 'failed',
    session_state: 'failed',
    failure: refused,
    earlier_attempt_count: 2,
    earlier_attempts: [2, 1].map((number) => ({
      attempt_id: S.attempt(number),
      number,
      state: 'superseded' as const,
      session_state: 'failed' as const,
      queued_at: '2026-11-24T01:00:00.000Z',
      ended_at: `2026-11-24T0${number}:28:00.000Z`,
      failure: refused,
    })),
  })
  const later = sessionRow({ attempt_id: S.attempt(9), batch_id: H.batch, job_id: S.job(9) })
  const first = sessionList({
    sessions: [row],
    next_before: 'bmV4dA',
    batches: [
      {
        batch_id: H.batch,
        archived: false,
        sessions: 2,
        matching: 2,
        // A resumed turn rewrites `started_at`; the server keeps the earliest start.
        first_started_at: '2026-11-24T00:05:00.000Z',
      },
    ],
  })
  const api = clients(failedJob(), first)
  api.agents.sessions.mockImplementation(async (query?: AgentSessionQueryDto) =>
    query?.before ? sessionList({ ...first, sessions: [later], next_before: null }) : first,
  )
  mount(api, 'overview')

  const card = await screen.findByRole('region', { name: 'Agent sessions' })
  expect(api.agents.sessions).toHaveBeenCalledWith(
    expect.objectContaining({ filter: 'all', batch_id: H.batch }),
  )
  await within(card).findByText('2 earlier attempts failed')
  // A failed row leads with its cause, with the advice behind help, beside its fold.
  const item = within(card)
    .getByRole('button', { name: /^Open session:/ })
    .closest('li')!
  expect(within(item).getAllByText("The Claude CLI refused this session's setup")[0]).toBeVisible()
  expect(within(item).getByRole('button', { name: 'What to do' })).toBeVisible()
  const started = screen.getByText('Started').parentElement!
  expect(started.querySelector('time')).toHaveAttribute('datetime', '2026-11-24T00:05:00.000Z')

  fireEvent.click(within(card).getByRole('button', { name: 'Load more' }))
  await waitFor(() =>
    expect(within(card).getAllByRole('button', { name: /^Open session:/ })).toHaveLength(2),
  )
})

test('a step card on a direct visit folds its earlier attempts from the history metadata', async () => {
  // The job is on no loaded page of either list read.
  const api = clients(failedJob(), sessionList({ next_before: 'bW9yZQ' }))
  mount(api, 'research')

  const outputs = await screen.findByRole('region', { name: 'Outputs' })
  const fold = await within(outputs).findByText('2 earlier attempts')
  expect(api.processing.history).not.toHaveBeenCalled()
  fireEvent.click(fold)
  const details = fold.closest('details')!
  act(() => {
    details.open = true
    details.dispatchEvent(new Event('toggle'))
  })
  await waitFor(() => expect(api.processing.history).toHaveBeenCalledWith(H.batch, H.job))
  await within(details).findByText('2 earlier attempts failed')
  const attempts = within(details).getAllByRole('listitem')
  expect(attempts.map((item) => item.textContent)).toEqual([
    expect.stringContaining('Attempt 2'),
    expect.stringContaining('Attempt 1'),
  ])
  expect(attempts[0]).toHaveTextContent("The Claude CLI refused this session's setup")
})

test('the drawer’s Start fresh is disabled with its reason while an earlier attempt holds a slot', async () => {
  const api = clients(failedJob({ allowed: false, reason: 'session_reap_pending' }))
  mount(api, 'research', H.job)

  const drawer = await screen.findByRole('dialog')
  const fresh = await within(drawer).findByRole('button', { name: 'Start a fresh session' })
  expect(fresh).toHaveAccessibleDescription(
    'An earlier attempt still holds its slot until its process is confirmed stopped.',
  )
  fireEvent.click(fresh)
  expect(api.processing.replaceSession).not.toHaveBeenCalled()
})

test('a stale Start fresh is refused with its reason and every read carrying eligibility is read again', async () => {
  const api = clients(failedJob())
  api.processing.replaceSession.mockRejectedValueOnce(
    new IntakeRequestError(409, 'agent_settings_required'),
  )
  mount(api, 'research')

  const outputs = await screen.findByRole('region', { name: 'Outputs' })
  const fresh = within(outputs).getByRole('button', { name: 'Start fresh' })
  await waitFor(() => expect(fresh).not.toHaveAttribute('aria-disabled'))
  const reads = api.processing.read.mock.calls.length
  const lists = api.agents.sessions.mock.calls.length
  fireEvent.click(fresh)

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Start fresh was refused: No agent is chosen for this step. Choose one in Agent settings.',
  )
  await waitFor(() => expect(api.processing.read.mock.calls.length).toBeGreaterThan(reads))
  await waitFor(() => expect(api.agents.sessions.mock.calls.length).toBeGreaterThan(lists))
})

test('a step card offers Start fresh disabled with its reason for a retired lot', async () => {
  const api = clients(failedJob({ allowed: false, reason: 'subject_retired' }))
  mount(api, 'research')

  const outputs = await screen.findByRole('region', { name: 'Outputs' })
  const fresh = within(outputs).getByRole('button', { name: 'Start fresh' })
  expect(fresh).toHaveAccessibleDescription(
    'This lot was retired, so its session can’t start again.',
  )
})

test('Start fresh from the Agents page runs only on the session page, under its own Processing read', async () => {
  const api = clients(failedJob())
  const read = deferred<ProcessingSnapshotDto>()
  api.processing.read.mockReturnValueOnce(read.promise)
  mount(api, 'research', undefined, H.job)

  const fresh = await screen.findByRole('button', { name: 'Start a fresh session' })
  // Until this page's own read lands the command waits, whatever the Agents page showed.
  expect(fresh).toHaveAccessibleDescription('Updating…')
  fireEvent.click(fresh)
  expect(api.processing.replaceSession).not.toHaveBeenCalled()

  await act(async () => {
    read.resolve(snapshotWith(failedJob()))
    await read.promise
  })
  await waitFor(() => expect(fresh).not.toHaveAttribute('aria-disabled'))
  expect(fresh).toBeEnabled()
  fireEvent.click(fresh)
  await waitFor(() =>
    expect(api.processing.replaceSession).toHaveBeenCalledWith(
      H.batch,
      H.job,
      { expected_capture_revision: '8', expected_revision: '4', attempt_id: H.attempt },
      expect.any(String),
    ),
  )
})

test.each([
  { place: 'a step card', view: 'research' as const, page: undefined, name: 'Start fresh' },
  {
    place: 'the session page',
    view: 'research' as const,
    page: H.job,
    name: 'Start a fresh session',
  },
])('a settings save in this tab refreshes $place’s Start fresh', async ({ view, page, name }) => {
  const api = clients(failedJob({ allowed: false, reason: 'agent_settings_required' }))
  const cache = mount(api, view, undefined, page)
  const fresh = await screen.findByRole('button', { name })
  await waitFor(() =>
    expect(fresh).toHaveAccessibleDescription(
      'No agent is chosen for this step. Choose one in Agent settings.',
    ),
  )

  // A provider is chosen and saved: the save re-reads what carries eligibility.
  api.processing.read.mockResolvedValue(snapshotWith(failedJob({ allowed: true })))
  api.processing.history.mockResolvedValue({
    ...threeAttempts(),
    session: { ...threeAttempts().session, start_fresh: { allowed: true } },
  })
  act(() => invalidateStartFreshReads(cache, scope))
  await waitFor(() => expect(fresh).not.toHaveAttribute('aria-disabled'))
  expect(fresh).toBeEnabled()
})

test('a failed row in Processing’s session list offers Start fresh, its failure details and its lot', async () => {
  const row = sessionRow({
    attempt_id: H.attempt,
    batch_id: H.batch,
    job_id: H.job,
    subject_id: H.lot,
    state: 'failed',
    session_state: 'failed',
    failure: refused,
  })
  const api = clients(failedJob(), sessionList({ sessions: [row] }))
  mount(api, 'overview')

  const card = await screen.findByRole('region', { name: 'Agent sessions' })
  const recovery = await within(card).findByRole('group', {
    name: 'Recover Research · GE S2CN1 diodes',
  })
  expect(
    within(recovery).getByRole('link', { name: 'Open lot in Review: GE S2CN1 diodes' }),
  ).toHaveAttribute('href', `#${H.batch}/review/lots/${H.lot}`)
  fireEvent.click(within(recovery).getByRole('button', { name: 'Failure details' }))
  expect(within(card).getByRole('region', { name: 'Session failure' })).toBeVisible()
  expect(api.processing.replaceSession).not.toHaveBeenCalled()

  const fresh = within(recovery).getByRole('button', { name: 'Start fresh' })
  await waitFor(() => expect(fresh).not.toHaveAttribute('aria-disabled'))
  fireEvent.click(fresh)
  await waitFor(() => expect(api.processing.replaceSession).toHaveBeenCalledTimes(1))
})

test('Start fresh sends the capture revision of the read that gave the job’s revision', async () => {
  const api = clients(failedJob())
  // The batch prop still holds revision 8; this mount's Processing read is at 9.
  api.processing.read.mockResolvedValue(snapshotWith(failedJob(), '9'))
  mount(api, 'research')

  const outputs = await screen.findByRole('region', { name: 'Outputs' })
  const fresh = within(outputs).getByRole('button', { name: 'Start fresh' })
  await waitFor(() => expect(fresh).not.toHaveAttribute('aria-disabled'))
  fireEvent.click(fresh)
  await waitFor(() =>
    expect(api.processing.replaceSession).toHaveBeenCalledWith(
      H.batch,
      H.job,
      expect.objectContaining({ expected_capture_revision: '9' }),
      expect.any(String),
    ),
  )
})

test('a stale Cancel is not reported as a refused Start fresh', async () => {
  const running: ProcessingJobDto = {
    ...failedJob(),
    state: 'running',
    session_state: 'running',
    can_cancel: true,
  }
  const api = clients(running)
  api.processing.cancel = vi.fn().mockRejectedValue(new IntakeRequestError(412, 'stale_attempt'))
  mount(api, 'research')

  const outputs = await screen.findByRole('region', { name: 'Outputs' })
  const cancel = within(outputs).getByRole('button', { name: 'Cancel this attempt' })
  await waitFor(() => expect(cancel).not.toHaveAttribute('aria-disabled'))
  fireEvent.click(cancel)
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('Command not confirmed')
  expect(alert).not.toHaveTextContent(/Start fresh/)
})

test('a row and the Processing read showing different attempts keep Start fresh waiting', async () => {
  // The list still shows attempt 2; this mount's read already holds attempt 3.
  const row = sessionRow({
    attempt_id: H.attempt2,
    batch_id: H.batch,
    job_id: H.job,
    subject_id: H.lot,
    state: 'failed',
    session_state: 'failed',
    failure: refused,
  })
  const api = clients(failedJob(), sessionList({ sessions: [row] }))
  mount(api, 'overview')

  const card = await screen.findByRole('region', { name: 'Agent sessions' })
  const recovery = await within(card).findByRole('group', { name: /^Recover/ })
  const fresh = within(recovery).getByRole('button', { name: 'Start fresh' })
  expect(fresh).toHaveAccessibleDescription('Updating…')
  fireEvent.click(fresh)
  expect(api.processing.replaceSession).not.toHaveBeenCalled()
})

test('without the session list a failed row says where its cause is, and still offers recovery', async () => {
  const api = clients(failedJob())
  api.agents.sessions.mockRejectedValue(new Error('offline'))
  mount(api, 'overview')

  const card = await screen.findByRole('region', { name: 'Agent sessions' })
  expect(
    await within(card).findByText('Failed · its cause shows on the full session page'),
  ).toBeVisible()
  expect(within(card).queryByText('Failed · the cause wasn’t recorded')).not.toBeInTheDocument()
  expect(within(card).getByRole('link', { name: /^Open full session:/ })).toHaveAttribute(
    'href',
    `#${H.batch}/processing/research/sessions/${H.job}`,
  )
  const recovery = within(card).getByRole('group', { name: /^Recover/ })
  expect(within(recovery).getByRole('button', { name: 'Start fresh' })).toBeVisible()
})

test('a failed row stays offering Start fresh, unavailable, while the Processing read shows a later running attempt', async () => {
  const row = sessionRow({
    attempt_id: H.attempt2,
    batch_id: H.batch,
    job_id: H.job,
    subject_id: H.lot,
    state: 'failed',
    session_state: 'failed',
    failure: refused,
  })
  const running: ProcessingJobDto = { ...failedJob(), state: 'running', session_state: 'running' }
  const api = clients(running, sessionList({ sessions: [row] }))
  mount(api, 'overview')

  const card = await screen.findByRole('region', { name: 'Agent sessions' })
  const recovery = await within(card).findByRole('group', { name: /^Recover/ })
  const fresh = within(recovery).getByRole('button', { name: 'Start fresh' })
  expect(fresh).toHaveAccessibleDescription('Updating…')
  fireEvent.click(fresh)
  expect(api.processing.replaceSession).not.toHaveBeenCalled()
})

test('open failure details fall back to where the cause is when the session list stops reading', async () => {
  const row = sessionRow({
    attempt_id: H.attempt,
    batch_id: H.batch,
    job_id: H.job,
    subject_id: H.lot,
    state: 'failed',
    session_state: 'failed',
    failure: refused,
  })
  const api = clients(failedJob(), sessionList({ sessions: [row] }))
  const cache = mount(api, 'overview')
  const card = await screen.findByRole('region', { name: 'Agent sessions' })
  const recovery = await within(card).findByRole('group', { name: /^Recover/ })
  fireEvent.click(within(recovery).getByRole('button', { name: 'Failure details' }))
  expect(within(card).getByRole('region', { name: 'Session failure' })).toBeVisible()

  api.agents.sessions.mockRejectedValue(new Error('offline'))
  await act(async () => {
    await cache.refetchQueries({ queryKey: ['intake'] }).catch(() => {})
  })
  expect(
    await within(card).findByText('Failed · its cause shows on the full session page'),
  ).toBeVisible()
  expect(within(card).queryByText('Failed · the cause wasn’t recorded')).not.toBeInTheDocument()
})
