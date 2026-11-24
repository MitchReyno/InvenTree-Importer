import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { fixtureScope, render } from '#/test/render'
import { deferred } from '#/test/deferred'
import { createServerQueryClient } from '#/queries/client'
import { freshReads } from '#/queries/fresh-reads'
import { serverQueryKey } from '#/queries/scope'
import { AgentSessions } from './AgentSessions'
import { debugModeController } from '#/debug/debug-mode'
import { agentSettings } from '#/test/agent-settings'
import { S, sessionList, sessionRow } from '#/test/agent-sessions'
import { localDayBounds, sessionListKey } from '#/agents/session-list'
import type {
  AgentSessionFilter,
  AgentSessionListDto,
  AgentSessionQueryDto,
  SessionFailureDto,
  SessionFailureSummaryDto,
} from '@invimport/contracts'

const selection = {
  provider: 'codex',
  authentication: 'subscription',
  model: 'chosen-model',
} as const

const heyyy = S.batch(1)
const spill = S.batch(2)
const quiet = S.batch(3)
const archived = S.batch(4)

const overloaded: SessionFailureSummaryDto = {
  id: S.failure(1),
  category: 'provider_network',
  summary: 'The provider connection or protocol failed.',
  recovery: 'Claude was busy or unreachable. Start a fresh session when it’s back.',
  details_available: true,
  failed_at: '2026-11-06T08:17:00.000Z',
  cause: {
    code: 'agent_turn_failed',
    provider: 'claude',
    provider_error: { kind: 'overloaded', result: null, http_status: 529 },
  },
  last_status: { text: 'Reading the batch and fetching photos', at: '2026-11-06T08:16:00.000Z' },
}

const refused: SessionFailureSummaryDto = {
  id: S.failure(2),
  category: 'configuration',
  summary: 'The native session configuration was not accepted.',
  recovery: 'Check the supported CLI version and configuration.',
  details_available: false,
  cause: { code: 'agent_admission_unavailable', provider: 'claude' },
}

const failedResearch = sessionRow({
  attempt_id: S.attempt(1),
  job_id: S.job(1),
  batch_id: heyyy,
  subject_id: S.lot(1),
  state: 'failed',
  session_state: 'failed',
  progress: 'settled',
  attempt_number: 3,
  failure: overloaded,
  state_since: '2026-11-06T08:17:00.000Z',
  start_fresh: { allowed: true },
  earlier_attempt_count: 2,
  earlier_attempts: [
    {
      attempt_id: S.attempt(11),
      number: 2,
      state: 'superseded',
      session_state: 'failed',
      queued_at: '2026-11-06T02:00:00.000Z',
      ended_at: '2026-11-06T02:29:00.000Z',
      failure: refused,
    },
    {
      attempt_id: S.attempt(12),
      number: 1,
      state: 'superseded',
      session_state: 'failed',
      queued_at: '2026-11-05T23:00:00.000Z',
      ended_at: '2026-11-05T23:28:00.000Z',
      failure: refused,
    },
  ],
})

const waitingExamine = sessionRow({
  attempt_id: S.attempt(2),
  job_id: S.job(2),
  batch_id: heyyy,
  subject_id: null,
  stage: 'examine',
  state: 'waiting_for_user',
  session_state: 'waiting_input',
  latest_status: { text: 'Asked about the last letter', at: '2026-11-06T08:04:00.000Z' },
})

const cannotResume = sessionRow({
  attempt_id: S.attempt(3),
  job_id: S.job(3),
  batch_id: spill,
  subject_id: S.lot(3),
  state: 'interrupted',
  session_state: 'resume_unavailable',
  start_fresh: { allowed: false, reason: 'subject_retired' },
})

const doneImages = sessionRow({
  attempt_id: S.attempt(4),
  job_id: S.job(4),
  batch_id: quiet,
  stage: 'images',
  state: 'ready',
  session_state: 'finished',
  latest_status: {
    text: 'Proposed images · quantity 25, estimated',
    at: '2026-11-06T09:30:00.000Z',
  },
})

const archivedResearch = sessionRow({
  attempt_id: S.attempt(5),
  job_id: S.job(5),
  batch_id: archived,
  state: 'failed',
  session_state: 'failed',
  archived: true,
  start_fresh: { allowed: false, reason: 'batch_archived' },
})

const counts = { needs_attention: 3, working: 0, waiting: 1, queued: 0, done_today: 1, all: 6 }
const totals = { slots_in_use: 2, queued: 1, waiting: 1 }

const batchSummary = (
  batch_id: string,
  sessions: number,
  matching: number,
  archivedBatch = false,
) => ({
  batch_id,
  archived: archivedBatch,
  sessions,
  matching,
  first_started_at: null,
})

const lists: Partial<Record<AgentSessionFilter, AgentSessionListDto>> = {
  needs_attention: sessionList({
    filter: 'needs_attention',
    sessions: [failedResearch, waitingExamine, cannotResume],
    counts,
    totals,
    batches: [batchSummary(heyyy, 3, 2), batchSummary(spill, 1, 1), batchSummary(quiet, 3, 0)],
  }),
  all: sessionList({
    filter: 'all',
    sessions: [failedResearch, waitingExamine, cannotResume, doneImages, archivedResearch],
    counts,
    totals,
    batches: [
      batchSummary(heyyy, 3, 3),
      batchSummary(spill, 1, 1),
      batchSummary(quiet, 3, 3),
      batchSummary(archived, 1, 1, true),
    ],
  }),
}

function serve(responses = lists) {
  return vi.fn(async (query?: AgentSessionQueryDto) => {
    const filter = query?.filter ?? 'all'
    return responses[filter] ?? sessionList({ filter, counts, totals })
  })
}

function client(responses = lists) {
  return {
    sessions: serve(responses),
    settings: vi.fn(async () => agentSettings('1', selection)),
    failure: vi.fn(),
  }
}

const names: Record<string, string> = {
  [heyyy]: 'Heyyy',
  [spill]: 'Spill',
  [quiet]: 'Quiet',
  [archived]: 'Old batch',
}

const batches = vi.fn(async (id: string) => ({
  title: names[id] ?? 'Batch',
  subjects: new Map([
    [S.lot(1), 'GE S2CN1 diodes'],
    [S.lot(3), 'Spilled resistors'],
  ]),
  liveLots: new Set([S.lot(1)]),
}))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 6, 12))
})

afterEach(() => {
  vi.useRealTimers()
  act(() => debugModeController().setEnabled(false))
})

function rowOf(group: HTMLElement, name: RegExp) {
  return within(group)
    .getAllByRole('row')
    .find((row) => within(row).queryAllByRole('link', { name }).length > 0)!
}

test('the page opens on Needs attention: failed, waiting and unresumable sessions, with quiet batches collapsed', async () => {
  const api = client()
  render(<AgentSessions client={api} batches={batches} />)

  const heyyyGroup = await screen.findByRole('region', { name: 'Heyyy' })
  expect(api.sessions).toHaveBeenCalledWith(expect.objectContaining({ filter: 'needs_attention' }))
  const chip = screen.getByRole('button', { name: /^Needs attention/ })
  expect(chip).toHaveAttribute('aria-pressed', 'true')
  expect(chip).toHaveTextContent('3')
  expect(within(heyyyGroup).getAllByRole('link', { name: /^Open session:/ })).toHaveLength(2)
  const spillGroup = screen.getByRole('region', { name: 'Spill' })
  expect(within(spillGroup).getAllByRole('link', { name: /^Open session:/ })).toHaveLength(1)
  const quietGroup = screen.getByRole('region', { name: 'Quiet' })
  expect(quietGroup).toHaveTextContent('3 sessions · nothing needs attention')
  expect(within(quietGroup).queryByRole('table')).not.toBeInTheDocument()
  expect(screen.queryByRole('region', { name: 'Old batch' })).not.toBeInTheDocument()
})

test('every request carries the browser’s local day, so Done today counts the operator’s day', async () => {
  const api = client()
  render(<AgentSessions client={api} batches={batches} />)
  await screen.findByRole('region', { name: 'Heyyy' })

  const day = localDayBounds(new Date(2026, 10, 6, 12))
  expect(api.sessions).toHaveBeenCalledWith(expect.objectContaining(day))
  expect(screen.getByRole('button', { name: /^Done today/ })).toHaveTextContent('1')
  fireEvent.click(screen.getByRole('button', { name: /^Done today/ }))
  await waitFor(() => expect(api.sessions).toHaveBeenCalledWith({ filter: 'done_today', ...day }))
})

test('an archived batch shows only under All', async () => {
  render(<AgentSessions client={client()} batches={batches} />)
  await screen.findByRole('region', { name: 'Heyyy' })
  expect(screen.queryByRole('region', { name: 'Old batch' })).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: /^All/ }))
  const old = await screen.findByRole('region', { name: 'Old batch' })
  expect(within(old).getByText('Archived')).toBeVisible()
  const row = rowOf(old, /^Open session:/)
  expect(within(row).getByRole('button', { name: 'Start fresh' })).toHaveAccessibleDescription(
    'The batch is archived. Resume it to start a fresh session.',
  )
})

test('the summary counts slots from the server’s totals, the model and what needs attention', async () => {
  render(<AgentSessions client={client()} batches={batches} />)
  const summary = await screen.findByRole('region', { name: 'Summary' })

  expect(await within(summary).findByText('2 of 3 slots in use · 1 queued')).toBeInTheDocument()
  expect(within(summary).getByText('3 sessions · 1 waiting for you')).toBeInTheDocument()
  expect(within(summary).getByText('Codex · chosen-model')).toBeInTheDocument()
})

test('waiting sessions do not count as running: 3 of 3 slots, 2 waiting, each holding no slot', async () => {
  const running = (n: number) =>
    sessionRow({
      attempt_id: S.attempt(20 + n),
      job_id: S.job(20 + n),
      state: 'running',
      session_state: 'running',
      occupies_lane: true,
    })

  const waiting = (n: number) =>
    sessionRow({
      attempt_id: S.attempt(30 + n),
      job_id: S.job(30 + n),
      state: 'waiting_for_user',
      session_state: 'waiting_input',
    })

  const list = sessionList({
    filter: 'all',
    sessions: [running(1), running(2), running(3), waiting(1), waiting(2)],
    counts: { ...counts, working: 3, waiting: 2 },
    totals: { slots_in_use: 3, queued: 0, waiting: 2 },
    batches: [batchSummary(S.batch(1), 5, 5)],
  })
  const api = client({ all: list, needs_attention: { ...list, filter: 'needs_attention' } })
  render(<AgentSessions client={api} batches={batches} />)
  const summary = await screen.findByRole('region', { name: 'Summary' })

  expect(await within(summary).findByText('3 of 3 slots in use')).toBeInTheDocument()
  expect(within(summary).getByText(/2 waiting for you/)).toBeInTheDocument()
  expect(screen.getAllByText('holds no slot')).toHaveLength(2)
})

test('one row per session, its earlier attempts folded with each attempt’s time and cause', async () => {
  render(<AgentSessions client={client()} batches={batches} />)
  const group = await screen.findByRole('region', { name: 'Heyyy' })
  const row = rowOf(group, /GE S2CN1 diodes/)

  const fold = within(row).getByText('2 earlier attempts failed')
  expect(fold.closest('details')).not.toHaveAttribute('open')
  fireEvent.click(fold)
  const attempts = within(row).getAllByRole('listitem')
  expect(attempts).toHaveLength(2)
  expect(attempts[0]).toHaveTextContent('Attempt 2')
  expect(attempts[0]).toHaveTextContent("The Claude CLI refused this session's setup")
  expect(attempts[0].querySelector('time')).toHaveAttribute('datetime', '2026-11-06T02:29:00.000Z')
})

test('a failed row leads with its cause and offers Start fresh, Open session, Failure details and the lot', async () => {
  render(<AgentSessions client={client()} batches={batches} />)
  const group = await screen.findByRole('region', { name: 'Heyyy' })
  const row = rowOf(group, /GE S2CN1 diodes/)
  const page = `#${heyyy}/processing/research/sessions/${S.job(1)}`

  expect(
    within(row).getByText("Couldn't reach Claude: the API was overloaded (HTTP 529)"),
  ).toBeVisible()
  expect(within(row).getByText('Last status: Reading the batch and fetching photos')).toBeVisible()
  expect(
    within(row).getByRole('link', { name: 'Open session: Research · GE S2CN1 diodes' }),
  ).toHaveAttribute('href', page)
  const recovery = within(row).getByRole('group', { name: 'Recover Research · GE S2CN1 diodes' })
  // Start fresh needs the batch's current read, so it opens the session page to run there.
  expect(within(recovery).getByRole('link', { name: 'Start fresh' })).toHaveAttribute('href', page)
  expect(within(recovery).getByRole('link', { name: 'Open session' })).toHaveAttribute('href', page)
  expect(within(recovery).getByRole('button', { name: 'Failure details' })).toBeVisible()
  expect(
    within(recovery).getByRole('link', { name: 'Open lot in Review: GE S2CN1 diodes' }),
  ).toHaveAttribute('href', `#${heyyy}/review/lots/${S.lot(1)}`)
})

test('Start fresh is disabled with its reason where the batch can’t start the session again', async () => {
  render(<AgentSessions client={client()} batches={batches} />)
  const group = await screen.findByRole('region', { name: 'Spill' })
  const row = rowOf(group, /Spilled resistors/)

  const fresh = within(row).getByRole('button', { name: 'Start fresh' })
  expect(fresh).toHaveAccessibleDescription(
    'This lot was retired, so its session can’t start again.',
  )
  expect(within(row).queryByRole('link', { name: 'Start fresh' })).not.toBeInTheDocument()
  // A retired lot has nothing to open in Review.
  expect(within(row).queryByRole('link', { name: /Open lot in Review/ })).not.toBeInTheDocument()
  // An unresumable session with no recorded failure says the cause wasn't recorded.
  expect(within(row).getByText('Failed · the cause wasn’t recorded')).toBeVisible()
})

test('opening failure details reads only, shows the advice behind help and never starts a retry', async () => {
  act(() => debugModeController().setEnabled(true))
  const api = client()
  const diagnostic = { ...overloaded, code: 'agent_turn_failed' } as unknown as SessionFailureDto
  api.failure.mockResolvedValue(diagnostic)
  const before = api.sessions.mock.calls.length
  render(<AgentSessions client={api} batches={batches} />)
  const group = await screen.findByRole('region', { name: 'Heyyy' })
  const row = rowOf(group, /GE S2CN1 diodes/)

  fireEvent.click(within(row).getByRole('button', { name: 'Failure details' }))
  const failure = within(row).getByRole('region', { name: 'Session failure' })
  fireEvent.click(within(failure).getByRole('button', { name: 'What to do' }))
  expect(await screen.findByText(/Claude was busy or unreachable/)).toBeVisible()
  expect(within(failure).getByText(/provider_network · agent_turn_failed/)).toBeVisible()
  fireEvent.click(within(failure).getByRole('button', { name: 'Show details' }))
  await waitFor(() => expect(api.failure).toHaveBeenCalledWith(S.attempt(1), S.failure(1)))
  // Only reads: the page has no command to send, and the list is not re-read by opening it.
  expect(api.sessions.mock.calls.length - before).toBe(1)
})

test('a failure followed by a successful attempt reads Done, with its failure folded and no recovery', async () => {
  const recovered = sessionRow({
    attempt_id: S.attempt(50),
    job_id: S.job(50),
    batch_id: quiet,
    state: 'ready',
    session_state: 'finished',
    attempt_number: 2,
    earlier_attempt_count: 1,
    earlier_attempts: [
      {
        attempt_id: S.attempt(51),
        number: 1,
        state: 'superseded',
        session_state: 'failed',
        queued_at: '2026-11-06T01:00:00.000Z',
        ended_at: '2026-11-06T01:10:00.000Z',
        failure: overloaded,
      },
    ],
  })
  const all = sessionList({
    ...lists.all!,
    sessions: [recovered],
    batches: [batchSummary(quiet, 1, 1)],
  })
  // The server leaves it out of Needs attention; under All it shows as done.
  render(<AgentSessions client={client({ ...lists, all })} batches={batches} />)
  const quietLine = await screen.findByRole('region', { name: 'Quiet' })
  expect(quietLine).toHaveTextContent('nothing needs attention')

  fireEvent.click(screen.getByRole('button', { name: /^All/ }))
  const group = await screen.findByRole('region', { name: 'Quiet' })
  const row = await within(group).findByRole('row', { name: /Research/ })
  expect(within(row).getByText('Done')).toBeVisible()
  expect(within(row).getByText('1 earlier attempt failed')).toBeInTheDocument()
  expect(within(row).queryByRole('group', { name: /^Recover/ })).not.toBeInTheDocument()
})

test('an earlier profile’s attempt has no page to open, and a cancelled turn still shows its cause', async () => {
  const legacy = sessionRow({
    attempt_id: S.attempt(60),
    job_id: S.job(60),
    batch_id: quiet,
    state: 'ready',
    session_state: null,
  })
  const cancelled = sessionRow({
    attempt_id: S.attempt(61),
    job_id: S.job(61),
    batch_id: quiet,
    stage: 'images',
    state: 'cancelled',
    session_state: 'cancelled',
    failure: { ...refused, id: S.failure(61) },
  })
  const all = sessionList({
    ...lists.all!,
    sessions: [legacy, cancelled],
    batches: [batchSummary(quiet, 2, 2)],
  })
  render(<AgentSessions client={client({ ...lists, all })} batches={batches} />)
  await screen.findByRole('region', { name: 'Quiet' })
  fireEvent.click(screen.getByRole('button', { name: /^All/ }))
  const group = await screen.findByRole('region', { name: 'Quiet' })

  await within(group).findByText('Research · GE S2CN1 diodes')
  expect(within(group).getAllByRole('link', { name: /^Open session:/ })).toHaveLength(1)
  expect(within(group).getByText("The Claude CLI refused this session's setup")).toBeVisible()
})

test('switching to a filter not read yet keeps the chips in place while its rows load', async () => {
  vi.useRealTimers()
  const api = client()
  render(<AgentSessions client={api} batches={batches} />)
  await screen.findByRole('region', { name: 'Heyyy' })
  const working = deferred<AgentSessionListDto>()
  api.sessions.mockReturnValueOnce(working.promise)

  const chip = screen.getByRole('button', { name: /^Working/ })
  chip.focus()
  fireEvent.click(chip)
  expect(chip).toBeInTheDocument()
  expect(chip).toHaveFocus()
  expect(await screen.findByText('Updating…')).toBeVisible()
  expect(screen.queryByRole('region', { name: 'Heyyy' })).not.toBeInTheDocument()

  await act(async () => {
    working.resolve(sessionList({ filter: 'working', counts, totals }))
    await working.promise
  })
  expect(await screen.findByText('No sessions match this filter.')).toBeVisible()
  expect(chip).toHaveAttribute('aria-pressed', 'true')
})

test('Load more adds the next page of sessions beneath the first', async () => {
  const later = sessionRow({
    attempt_id: S.attempt(40),
    job_id: S.job(40),
    batch_id: heyyy,
    state: 'failed',
    session_state: 'failed',
  })
  const first = {
    ...lists.needs_attention!,
    next_before: 'b2xkZXI',
    batches: [batchSummary(heyyy, 4, 3), batchSummary(spill, 1, 1)],
  }
  const api = client({ needs_attention: first })
  api.sessions.mockImplementation(async (query?: AgentSessionQueryDto) =>
    query?.before === 'b2xkZXI'
      ? sessionList({ ...first, sessions: [later], next_before: null })
      : first,
  )
  render(<AgentSessions client={api} batches={batches} />)
  const group = await screen.findByRole('region', { name: 'Heyyy' })
  expect(group).toHaveTextContent('1 more session on later pages.')

  fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
  await waitFor(() =>
    expect(within(group).getAllByRole('link', { name: /^Open session:/ })).toHaveLength(3),
  )
  // Every page is in: the button stays where focus was and says so.
  const more = screen.getByRole('button', { name: 'Load more' })
  expect(more).toHaveAttribute('aria-disabled', 'true')
  expect(more).toHaveAccessibleDescription('Every session is loaded.')
})

test('Load more stays in place while its page loads, and a page that failed can be read again', async () => {
  vi.useRealTimers()
  const first = { ...lists.needs_attention!, next_before: 'b2xkZXI' }
  const later = sessionRow({
    attempt_id: S.attempt(70),
    job_id: S.job(70),
    batch_id: heyyy,
    state: 'failed',
    session_state: 'failed',
  })
  const api = client({ needs_attention: first })
  const page = deferred<AgentSessionListDto>()
  api.sessions.mockImplementation(async (query?: AgentSessionQueryDto) =>
    query?.before ? page.promise : first,
  )
  render(<AgentSessions client={api} batches={batches} />)
  await screen.findByRole('region', { name: 'Heyyy' })

  const more = screen.getByRole('button', { name: 'Load more' })
  more.focus()
  fireEvent.click(more)
  expect(more).toBeInTheDocument()
  expect(more).toHaveFocus()
  await act(async () => {
    page.reject(new Error('offline'))
    await page.promise.catch(() => {})
  })
  expect(await screen.findByText(/More sessions couldn’t be read/)).toBeVisible()
  const retry = screen.getByRole('button', { name: 'Try loading more again' })
  expect(retry).toBe(more)

  api.sessions.mockImplementation(async (query?: AgentSessionQueryDto) =>
    query?.before ? sessionList({ ...first, sessions: [later], next_before: null }) : first,
  )
  fireEvent.click(retry)
  const group = screen.getByRole('region', { name: 'Heyyy' })
  await waitFor(() =>
    expect(within(group).getAllByRole('link', { name: /^Open session:/ })).toHaveLength(3),
  )
})

test('a loaded page whose re-read fails says its rows may be out of date and offers a retry', async () => {
  vi.useRealTimers()
  const cache = createServerQueryClient()
  const first = { ...lists.needs_attention!, next_before: 'b2xkZXI' }
  const later = sessionRow({
    attempt_id: S.attempt(80),
    job_id: S.job(80),
    batch_id: heyyy,
    state: 'failed',
    session_state: 'failed',
  })
  const api = client({ needs_attention: first })
  let failLater = false
  api.sessions.mockImplementation(async (query?: AgentSessionQueryDto) => {
    if (!query?.before) {
      return first
    }
    if (failLater) {
      throw new Error('offline')
    }
    return sessionList({ ...first, sessions: [later], next_before: null })
  })
  render(<AgentSessions client={api} batches={batches} />, { cache })
  await screen.findByRole('region', { name: 'Heyyy' })
  fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
  const group = screen.getByRole('region', { name: 'Heyyy' })
  await waitFor(() =>
    expect(within(group).getAllByRole('link', { name: /^Open session:/ })).toHaveLength(3),
  )

  failLater = true
  await act(async () => {
    await cache.refetchQueries({ queryKey: serverQueryKey(fixtureScope, 'agent-sessions') })
  })
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'More sessions couldn’t be read; those shown from it may be out of date.',
  )
  expect(within(group).getAllByRole('link', { name: /^Open session:/ })).toHaveLength(3)
  failLater = false
  fireEvent.click(screen.getByRole('button', { name: 'Try loading more again' }))
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
})

test('every added page whose re-read fails is reported, and one retry reads them all again', async () => {
  vi.useRealTimers()
  const cache = createServerQueryClient()

  const row = (n: number) =>
    sessionRow({
      attempt_id: S.attempt(n),
      job_id: S.job(n),
      batch_id: heyyy,
      state: 'failed',
      session_state: 'failed',
    })

  const first = { ...lists.needs_attention!, next_before: 'cGFnZTI' }
  const second = sessionList({ ...first, sessions: [row(90)], next_before: 'cGFnZTM' })
  const third = sessionList({ ...first, sessions: [row(91)], next_before: null })
  let failing = false
  const api = client({ needs_attention: first })
  api.sessions.mockImplementation(async (query?: AgentSessionQueryDto) => {
    if (query?.before && failing) {
      throw new Error('offline')
    }
    if (query?.before === 'cGFnZTI') {
      return second
    }
    return query?.before === 'cGFnZTM' ? third : first
  })
  render(<AgentSessions client={api} batches={batches} />, { cache })
  await screen.findByRole('region', { name: 'Heyyy' })
  const more = screen.getByRole('button', { name: 'Load more' })
  fireEvent.click(more)
  await waitFor(() => expect(more).not.toHaveAttribute('aria-busy'))
  fireEvent.click(more)
  await waitFor(() => expect(more).toHaveAccessibleDescription('Every session is loaded.'))

  // Both added pages fail their re-read together.
  failing = true
  await act(async () => {
    await cache.refetchQueries({ queryKey: serverQueryKey(fixtureScope, 'agent-sessions') })
  })
  expect(await screen.findByText(/More sessions couldn’t be read/)).toBeVisible()
  expect(screen.queryByText('Every session is loaded.')).not.toBeInTheDocument()
  failing = false

  const before = (cursor: string) =>
    api.sessions.mock.calls.filter(([query]) => query?.before === cursor).length

  const second0 = before('cGFnZTI')
  const third0 = before('cGFnZTM')
  fireEvent.click(screen.getByRole('button', { name: 'Try loading more again' }))
  await waitFor(() => expect(screen.queryByText(/More sessions couldn’t be read/)).toBeNull())
  expect(before('cGFnZTI')).toBeGreaterThan(second0)
  expect(before('cGFnZTM')).toBeGreaterThan(third0)
})

test('the Agents heading carries the AI mark; session rows do not', async () => {
  render(<AgentSessions client={client()} batches={batches} />)
  const heading = await screen.findByRole('heading', { name: 'Agents', level: 1 })

  expect(heading.querySelector('[data-ai-mark]')).toHaveAttribute('data-size', 'lg')
  await screen.findByRole('region', { name: 'Summary' })
  expect(document.querySelectorAll('[data-ai-mark]')).toHaveLength(1)
})

test('a setup without agent sessions says the server profile runs none', async () => {
  const none = sessionList({ sessions_supported: false })
  render(<AgentSessions client={client({ needs_attention: none, all: none })} batches={batches} />)

  expect(await screen.findByText(/Agent sessions are not available for this setup/)).toBeVisible()
  expect(screen.getByText(/server's processing profile does not run agent sessions/)).toBeVisible()
  expect(screen.queryByRole('link', { name: 'Agent settings' })).not.toBeInTheDocument()
  expect(screen.queryByText(/0 of 3 slots/)).not.toBeInTheDocument()
})

test('history failure is visible and does not hide it as a successful empty queue', async () => {
  const failing = {
    sessions: vi.fn().mockRejectedValue(new Error('offline')),
    settings: vi.fn(async () => agentSettings('1', selection)),
  }
  render(<AgentSessions client={failing} batches={batches} />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Session connection unavailable')
  expect(screen.queryByText(/No sessions/)).not.toBeInTheDocument()
})

test('a cancelled session still holding its slot reads as stopped, saying it still holds the slot', async () => {
  const holder = sessionRow({
    state: 'cancelled',
    session_state: 'cancelling',
    occupies_lane: true,
  })
  const done = sessionList({
    filter: 'done_today',
    sessions: [holder],
    counts,
    totals: { ...totals, slots_in_use: 1 },
    batches: [batchSummary(S.batch(1), 1, 1)],
  })
  render(<AgentSessions client={client({ ...lists, done_today: done })} batches={batches} />)
  await screen.findByRole('region', { name: 'Heyyy' })

  fireEvent.click(screen.getByRole('button', { name: /^Done today/ }))
  const group = await screen.findByRole('region', { name: 'Heyyy' })
  await within(group).findByText(/still holds its slot/)
  expect(within(group).queryByText('Working')).not.toBeInTheDocument()
})

test('Pause all agents pauses every batch, each batch pauses on its own, and paused sessions say so', async () => {
  vi.useRealTimers()
  const api = {
    ...client(),
    pause: vi.fn(async (batchId: string, paused: boolean) => ({ batch_id: batchId, paused })),
    pauseAll: vi.fn(async (paused: boolean) => ({ paused, batch_ids: [heyyy, spill] })),
  }
  render(<AgentSessions client={api} batches={batches} />)
  const summary = await screen.findByRole('region', { name: 'Summary' })
  fireEvent.click(within(summary).getByRole('button', { name: 'Pause all agents' }))
  await waitFor(() => expect(api.pauseAll).toHaveBeenCalledWith(true))

  // The list read after the pause says which batches are paused.
  const pausedList = {
    ...lists.needs_attention!,
    sessions: lists.needs_attention!.sessions.map((session) =>
      session.batch_id === heyyy ? { ...session, paused: true as const } : session,
    ),
    paused_batch_ids: [heyyy],
  }
  api.sessions.mockResolvedValue(pausedList)
  const group = await screen.findByRole('region', { name: 'Heyyy' })
  fireEvent.click(within(group).getByRole('button', { name: 'Pause all' }))
  await waitFor(() => expect(api.pause).toHaveBeenCalledWith(heyyy, true))
  const paused = await screen.findByRole('region', { name: 'Heyyy' })
  await within(paused).findByRole('button', { name: 'Resume' })
  // With one batch paused and another running, both global actions stay on offer.
  expect(within(summary).getByRole('button', { name: 'Resume all agents' })).toBeVisible()
  expect(within(summary).getByRole('button', { name: 'Pause all agents' })).toBeVisible()
})

test('a pause that fails says so and leaves the agents as they were', async () => {
  vi.useRealTimers()
  const api = {
    ...client(),
    pause: vi.fn().mockRejectedValue(new Error('offline')),
    pauseAll: vi.fn(),
  }
  render(<AgentSessions client={api} batches={batches} />)
  const group = await screen.findByRole('region', { name: 'Heyyy' })
  fireEvent.click(within(group).getByRole('button', { name: 'Pause all' }))
  expect(await within(group).findByRole('alert')).toHaveTextContent(
    'Pausing failed; the agents are still running.',
  )
  expect(within(group).getByRole('button', { name: 'Pause all' })).toBeVisible()
})

test('behind the whole window, a session group is raised and the table inside it is not', async () => {
  document.documentElement.dataset.masthead = 'window'
  try {
    render(<AgentSessions client={client()} batches={batches} />)
    const group = await screen.findByRole('region', { name: 'Heyyy' })
    const tableWrap = within(group).getByRole('table').parentElement!

    expect(getComputedStyle(group).boxShadow).toContain('shadow')
    expect(getComputedStyle(tableWrap).boxShadow).toBe('none')
  } finally {
    document.documentElement.dataset.masthead = 'bar'
  }
})

test('a first visit shows the page’s skeleton, not a loading line, until the list lands', async () => {
  vi.useRealTimers()
  const api = client()
  const list = deferred<AgentSessionListDto>()
  api.sessions.mockReturnValueOnce(list.promise)
  render(<AgentSessions client={api} batches={batches} />)

  expect(screen.getByRole('status')).toHaveTextContent('Loading')
  expect(screen.queryByRole('region', { name: 'Summary' })).not.toBeInTheDocument()

  await act(async () => {
    list.resolve(lists.needs_attention!)
    await list.promise
  })
  expect(await screen.findByRole('region', { name: 'Summary' })).toBeVisible()
})

test('a return visit shows the cached list at once, with Pause waiting quietly for the read', async () => {
  vi.useRealTimers()
  const cache = createServerQueryClient()
  const query = { filter: 'needs_attention' as const, ...localDayBounds(new Date()) }
  cache.setQueryData(sessionListKey(fixtureScope, query), lists.needs_attention)
  const api = {
    ...client(),
    pause: vi.fn(async (batchId: string, paused: boolean) => ({ batch_id: batchId, paused })),
    pauseAll: vi.fn(async (paused: boolean) => ({ paused, batch_ids: [] })),
  }
  const list = deferred<AgentSessionListDto>()
  api.sessions.mockReturnValueOnce(list.promise)
  render(<AgentSessions client={api} batches={batches} />, { cache })

  const summary = screen.getByRole('region', { name: 'Summary' })
  const pauseAll = within(summary).getByRole('button', { name: 'Pause all agents' })
  expect(pauseAll).toHaveAttribute('aria-disabled', 'true')
  expect(pauseAll).toHaveAccessibleDescription('Updating…')
  fireEvent.click(pauseAll)
  expect(api.pauseAll).not.toHaveBeenCalled()

  await act(async () => {
    list.resolve(lists.needs_attention!)
    await list.promise
  })
  await waitFor(() => expect(pauseAll).not.toHaveAttribute('aria-disabled'))
})

test('a running batch’s Pause waits for a read started after the last live hint', async () => {
  vi.useRealTimers()
  const cache = createServerQueryClient()
  const api = {
    ...client(),
    pause: vi.fn(async (batchId: string, paused: boolean) => ({ batch_id: batchId, paused })),
    pauseAll: vi.fn(),
  }
  render(<AgentSessions client={api} batches={batches} />, { cache })
  const group = await screen.findByRole('region', { name: 'Heyyy' })
  const pause = within(group).getByRole('button', { name: 'Pause all' })
  await waitFor(() => expect(pause).not.toHaveAttribute('aria-disabled'))

  act(() => freshReads(cache).noteHint())
  expect(pause).toHaveAccessibleDescription('Updating…')
  fireEvent.click(pause)
  expect(api.pause).not.toHaveBeenCalled()

  await act(async () => {
    await cache.invalidateQueries({ queryKey: serverQueryKey(fixtureScope, 'agent-sessions') })
  })
  await waitFor(() => expect(pause).not.toHaveAttribute('aria-disabled'))
  fireEvent.click(pause)
  await waitFor(() => expect(api.pause).toHaveBeenCalledWith(heyyy, true))
})
