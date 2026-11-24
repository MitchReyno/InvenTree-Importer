import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { IntakeRequestError } from '@invimport/contracts/client'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, onTestFinished, test, vi } from 'vitest'
import { setDebugMode } from '#/test/debug-mode'
import { onlineManager, type QueryClient } from '@tanstack/react-query'
import { freshReads } from './queries/fresh-reads'
import { validate, type CaptureSnapshotDto, type ProcessingSnapshotDto } from '@invimport/contracts'
import { ProcessingWorkspace } from './components/processing/ProcessingWorkspace'
import { ServerStateProvider } from './components/query/ServerStateProvider'
import { createServerQueryClient } from './queries/client'
import { serverQueryKey, type ServerScope } from './queries/scope'
import type { ProcessingClient } from './processing/types'
import { ApiClientsProvider } from './context'
import { useState, useSyncExternalStore } from 'react'
import { createDrawerRestore, type DrawerRestoreStore } from './processing/drawer-restore'
import { agentSettings } from '#/test/agent-settings'

const batchId = '10000000-0000-4000-8000-000000000001'
const subjectId = '20000000-0000-4000-8000-000000000002'
const jobId = '30000000-0000-4000-8000-000000000003'
const attemptId = '40000000-0000-4000-8000-000000000004'
const questionId = '50000000-0000-4000-8000-000000000005'
const scope: ServerScope = {
  origin: 'http://127.0.0.1:4310',
  actorId: '60000000-0000-4000-8000-000000000006',
  targetId: '70000000-0000-4000-8000-000000000007',
  targetContextId: '80000000-0000-4000-8000-000000000008',
}
const batch: CaptureSnapshotDto = {
  id: batchId,
  source_id: '90000000-0000-4000-8000-000000000009',
  title: 'Packet questions',
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
      id: subjectId,
      label: 'Packet A',
      revision: '3',
      contribution_key: 'a0000000-0000-4000-8000-000000000001',
      part_subject_id: null,
      quantity: { mode: 'inherit' },
      location: { mode: 'inherit' },
    },
  ],
  cursor: { stream_id: 'b0000000-0000-4000-8000-000000000002', sequence: '8' },
}
const snapshot: ProcessingSnapshotDto = {
  batch_id: batchId,
  capture_revision: '8',
  runner_status: 'fixture_only',
  cursor: batch.cursor,
  jobs: [
    {
      id: jobId,
      subject_id: subjectId,
      stage: 'reading',
      revision: '2',
      state: 'waiting_for_user',
      attempt_id: attemptId,
      input_sha256: 'a'.repeat(64),
      attempt_number: '1',
      qualification: 'fixture_only',
      proposals: [],
      questions: [
        {
          id: questionId,
          job_id: jobId,
          attempt_id: attemptId,
          input_sha256: 'a'.repeat(64),
          revision: '1',
          state: 'open',
          subject_id: subjectId,
          spec: {
            kind: 'quantity',
            prompt: 'How many are in Packet A?',
            reason: 'The label is unclear.',
          },
        },
      ],
    },
  ],
}
validate('CaptureSnapshot', batch)
validate('ProcessingSnapshot', snapshot)

/** A `/1` question's spec, which these fixtures all carry. */
function legacySpec(question: ProcessingSnapshotDto['jobs'][number]['questions'][number]) {
  if (!('spec' in question)) {
    throw new Error('expected a /1 question')
  }
  return question.spec
}

function clientFixture() {
  return {
    read: vi.fn().mockResolvedValue(snapshot),
    start: vi
      .fn()
      .mockResolvedValue({ batch_id: batchId, job_ids: [jobId], attempt_ids: [attemptId] }),
    cancel: vi
      .fn()
      .mockResolvedValue({ batch_id: batchId, job_ids: [jobId], attempt_ids: [attemptId] }),
    answer: vi.fn().mockResolvedValue({
      answer_id: 'c0000000-0000-4000-8000-000000000003',
      question_id: questionId,
      attempt_id: attemptId,
      capture_revision: '9',
      command_id: 'd0000000-0000-4000-8000-000000000004',
    }),
  } satisfies ProcessingClient
}

function deferredRead() {
  let resolve: (value: ProcessingSnapshotDto) => void = () => {
    throw new Error('deferred_read_not_ready')
  }

  const promise = new Promise<ProcessingSnapshotDto>((finish) => {
    resolve = finish
  })
  return { promise, resolve }
}

// The job reads its marking, so its attempt detail is on the Examine step page.
function mount(client: ProcessingClient, cache = createServerQueryClient()) {
  const dirty = vi.fn()
  const navigate = vi.fn()
  const view = render(
    <ServerStateProvider scope={scope} client={cache}>
      <ProcessingWorkspace
        batch={batch}
        client={client}
        view="examine"
        questionId={questionId}
        navigate={navigate}
        onDirtyChange={dirty}
        onSaved={vi.fn().mockResolvedValue(undefined)}
      />
    </ServerStateProvider>,
  )
  return { cache, dirty, navigate, rerender: view.rerender }
}

/** A command that can't be used now, whether disabled or quietly waiting for a read. */
function expectUnavailable(control: HTMLElement) {
  expect(control.hasAttribute('disabled') || control.getAttribute('aria-disabled') === 'true').toBe(
    true,
  )
}

/** A command that can be used now. */
function expectAvailable(control: HTMLElement) {
  expect(control).toBeEnabled()
  expect(control).not.toHaveAttribute('aria-disabled')
}

afterEach(() => {
  onlineManager.setOnline(true)
})

test('shows no processing profile notice and no qualification tag on job cards', async () => {
  const client = clientFixture()
  mount(client)
  expect((await screen.findAllByText(/How many are in Packet A\?/)).length).toBeGreaterThan(0)

  expect(screen.queryByText(/Synthetic processing fixture|Native agent profile/)).toBeNull()
  expect(screen.queryByText(/synthetic fixture only|live provider not qualified/)).toBeNull()
  expect(screen.queryByText(/Closing this browser/)).toBeNull()
})

test('warm cache and cache writes cannot authorize commands; failed reads retain a pinned dirty answer', async () => {
  const user = userEvent.setup()
  const client = clientFixture()
  const cache = createServerQueryClient()
  const key = serverQueryKey(scope, 'processing', batchId)
  cache.setQueryData(key, snapshot)
  const fresh = deferredRead()
  client.read.mockReturnValueOnce(fresh.promise)
  const mounted = mount(client, cache)
  expect(screen.queryByLabelText('Quantity')).not.toBeInTheDocument()
  await user.click(screen.getByRole('checkbox', { name: 'Packet A' }))
  const queue = screen.getByRole('button', { name: 'Queue new processing attempts' })
  const cancel = screen.getByRole('button', { name: 'Cancel this attempt' })
  expectUnavailable(queue)
  expectUnavailable(cancel)
  expect(
    screen.queryByRole('button', { name: 'Save answer and queue continuation' }),
  ).not.toBeInTheDocument()

  act(() => {
    cache.setQueryData(key, { ...snapshot, cursor: { ...snapshot.cursor, sequence: '99' } })
  })
  expectUnavailable(queue)
  expect(screen.queryByLabelText('Quantity')).not.toBeInTheDocument()
  expect(client.start).not.toHaveBeenCalled()
  await act(async () => {
    fresh.resolve(snapshot)
    await fresh.promise
  })
  await waitFor(() => expectAvailable(queue))
  const field = await screen.findByLabelText('Quantity')
  await user.type(field, '37')
  const answer = screen.getByRole('button', { name: 'Save answer and queue continuation' })
  expect(answer).toBeEnabled()
  expect(field).toHaveValue('37')

  client.read.mockRejectedValueOnce(new Error('read_unavailable'))
  await act(async () => {
    await cache.refetchQueries({ queryKey: key })
  })
  expect(await screen.findByText(/Processing status unavailable/)).toBeInTheDocument()
  expectUnavailable(queue)
  expectUnavailable(cancel)
  expect(answer).toBeDisabled()
  expect(field).toHaveValue('37')
  expect(mounted.dirty).toHaveBeenLastCalledWith(true)

  await act(async () => {
    await cache.refetchQueries({ queryKey: key })
  })
  await waitFor(() => expect(answer).toBeEnabled())
  const newer = structuredClone(snapshot)
  newer.capture_revision = '9'
  newer.jobs[0].questions[0].state = 'superseded'
  newer.jobs[0].questions.push({
    ...newer.jobs[0].questions[0],
    id: 'e0000000-0000-4000-8000-000000000005',
    state: 'open',
    spec: { ...legacySpec(newer.jobs[0].questions[0]), prompt: 'Replacement count question' },
  })
  client.read.mockResolvedValue(newer)
  await act(async () => {
    await cache.refetchQueries({ queryKey: key })
  })
  const form = screen.getByRole('form', { name: 'Pinned application question' })
  expect(within(form).getByText('How many are in Packet A?')).toBeInTheDocument()
  expect(within(form).queryByText('Replacement count question')).not.toBeInTheDocument()
  expect(field).toHaveValue('37')
  await waitFor(() => expect(answer).toBeDisabled())
  expect(mounted.navigate).not.toHaveBeenCalled()
})

test('cold mount pins only the fresh question state, never the stale warm-cache context', async () => {
  const user = userEvent.setup()
  const client = clientFixture()
  const cache = createServerQueryClient()
  const key = serverQueryKey(scope, 'processing', batchId)
  cache.setQueryData(key, snapshot)
  const fresh = deferredRead()
  client.read.mockReturnValueOnce(fresh.promise)
  mount(client, cache)
  await waitFor(() => expect(client.read).toHaveBeenCalledTimes(1))
  expect(
    screen.queryByRole('form', { name: 'Pinned application question' }),
  ).not.toBeInTheDocument()

  const current = structuredClone(snapshot)
  const currentAttempt = 'f0000000-0000-4000-8000-000000000006'
  current.capture_revision = '9'
  current.cursor.sequence = '9'
  current.jobs[0].attempt_id = currentAttempt
  current.jobs[0].attempt_number = '2'
  current.jobs[0].input_sha256 = 'b'.repeat(64)
  current.jobs[0].questions[0].state = 'answered'
  current.jobs[0].questions[0].revision = '2'
  current.jobs[0].questions.push({
    ...current.jobs[0].questions[0],
    id: 'e0000000-0000-4000-8000-000000000005',
    attempt_id: currentAttempt,
    input_sha256: 'b'.repeat(64),
    revision: '1',
    state: 'open',
    spec: { ...legacySpec(current.jobs[0].questions[0]), prompt: 'The new current question' },
  })
  validate('ProcessingSnapshot', current)
  await act(async () => {
    fresh.resolve(current)
    await fresh.promise
  })
  const form = await screen.findByRole('form', { name: 'Pinned application question' })
  setDebugMode(true)
  const identity = within(form).getByRole('group', { name: 'Debug: Question identity' })
  expect(identity).toHaveTextContent('Question revision2')
  expect(identity).not.toHaveTextContent('Question revision1')
  setDebugMode(false)
  expect(within(form).getByText('How many are in Packet A?')).toBeInTheDocument()
  expect(within(form).queryByText('The new current question')).not.toBeInTheDocument()
  await user.type(within(form).getByLabelText('Quantity'), '51')
  expect(
    within(form).getByRole('button', { name: 'Save answer and queue continuation' }),
  ).toBeDisabled()
  expect(client.answer).not.toHaveBeenCalled()
})

test('uncertain start keeps the original payload and key across query refreshes', async () => {
  const user = userEvent.setup()
  const client = clientFixture()
  client.start.mockRejectedValue(new Error('acknowledgement_lost'))
  mount(client)
  await screen.findByLabelText('Quantity')
  await user.click(screen.getByRole('checkbox', { name: 'Packet A' }))
  const queue = screen.getByRole('button', { name: 'Queue new processing attempts' })
  await waitFor(() => expect(queue).toBeEnabled())
  await user.click(queue)
  await waitFor(() => expect(client.start).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(queue).toBeEnabled())
  await user.click(queue)
  await waitFor(() => expect(client.start).toHaveBeenCalledTimes(2))
  expect(client.start.mock.calls[1]).toEqual(client.start.mock.calls[0])
  expect(client.start.mock.calls[0][1]).toMatchObject({
    expected_capture_revision: '8',
    subject_ids: [subjectId],
  })
})

test('a paused read blocks cached commands and stays blocked until the resumed read succeeds', async () => {
  const user = userEvent.setup()
  const client = clientFixture()
  const cache = createServerQueryClient()
  cache.setDefaultOptions({
    queries: { ...cache.getDefaultOptions().queries, networkMode: 'online' },
  })
  mount(client, cache)
  await screen.findByLabelText('Quantity')
  await user.click(screen.getByRole('checkbox', { name: 'Packet A' }))
  const queue = screen.getByRole('button', { name: 'Queue new processing attempts' })
  await waitFor(() => expectAvailable(queue))
  const resumed = deferredRead()
  client.read.mockReturnValueOnce(resumed.promise)
  const key = serverQueryKey(scope, 'processing', batchId)
  act(() => {
    onlineManager.setOnline(false)
    void cache.invalidateQueries({ queryKey: key })
  })
  await waitFor(() => expect(cache.getQueryState(key)?.fetchStatus).toBe('paused'))
  expectUnavailable(queue)
  expectUnavailable(screen.getByRole('button', { name: 'Cancel this attempt' }))
  act(() => {
    onlineManager.setOnline(true)
  })
  await waitFor(() => expect(client.read).toHaveBeenCalledTimes(2))
  expectUnavailable(queue)
  await act(async () => {
    resumed.resolve(snapshot)
    await resumed.promise
  })
  await waitFor(() => expectAvailable(queue))
})

test('archiving a verified workspace preserves the draft but refuses every mutation', async () => {
  const user = userEvent.setup()
  const client = clientFixture()
  const mounted = mount(client)
  const quantity = await screen.findByLabelText('Quantity')
  const selected = screen.getByRole('checkbox', { name: 'Packet A' })
  await user.click(selected)
  await user.type(quantity, '51')
  const queue = screen.getByRole('button', { name: 'Queue new processing attempts' })
  const cancel = screen.getByRole('button', { name: 'Cancel this attempt' })
  const answer = screen.getByRole('button', { name: 'Save answer and queue continuation' })
  await waitFor(() => expect(queue).toBeEnabled())
  expect(answer).toBeEnabled()
  expect(cancel).toBeEnabled()

  mounted.rerender(
    <ServerStateProvider scope={scope} client={mounted.cache}>
      <ProcessingWorkspace
        batch={{ ...batch, archived: true }}
        client={client}
        view="examine"
        questionId={questionId}
        navigate={mounted.navigate}
        onDirtyChange={mounted.dirty}
        onSaved={vi.fn().mockResolvedValue(undefined)}
      />
    </ServerStateProvider>,
  )
  expect(queue).toBeDisabled()
  expect(cancel).toBeDisabled()
  expect(answer).toBeDisabled()
  expect(selected).toBeDisabled()
  expect(quantity).toBeDisabled()
  expect(quantity).toHaveValue('51')
  expect(screen.getByText(/Resume it in the batch header/)).toBeInTheDocument()
  await user.click(queue)
  await user.click(cancel)
  await user.click(answer)
  await act(async () => {
    fireEvent.submit(screen.getByRole('form', { name: 'Pinned application question' }))
  })
  expect(client.start).not.toHaveBeenCalled()
  expect(client.cancel).not.toHaveBeenCalled()
  expect(client.answer).not.toHaveBeenCalled()
  const discard = screen.getByRole('button', { name: 'Discard unsaved answer' })
  expect(discard).toBeEnabled()
  await user.click(discard)
  expect(quantity).toHaveValue('')
  expect(mounted.dirty).toHaveBeenLastCalledWith(false)
})

test('retained V2 provenance and media blockers stay visible without replacing a pinned draft', async () => {
  const client = clientFixture()
  const withMedia: ProcessingSnapshotDto = structuredClone(snapshot)
  withMedia.jobs[0].blocked_code = 'media_not_ready'
  withMedia.jobs[0].proposals = [
    {
      id: 'e0000000-0000-4000-8000-000000000005',
      message_id: 'f0000000-0000-4000-8000-000000000006',
      value: {
        schema_version: 'bench-intake-proposal/2',
        subject_id: subjectId,
        summary: 'Synthetic descriptor receipt; no media content inspection.',
        sources: [
          {
            kind: 'media_version',
            evidence_id: 'a0000000-0000-4000-8000-000000000007',
            version_id: 'a0000000-0000-4000-8000-000000000008',
            sha256: 'b'.repeat(64),
          },
        ],
      },
    },
  ]
  validate('ProcessingSnapshot', withMedia)
  client.read.mockResolvedValue(withMedia)
  mount(client)
  expect(await screen.findByText(/Relevant media is still being prepared/)).toBeInTheDocument()
  // Source identities are internal and show only in debug mode.
  expect(screen.queryByRole('list', { name: 'Retained candidate sources' })).toBeNull()
  setDebugMode(true)
  const sources = screen.getByRole('list', { name: 'Retained candidate sources' })
  expect(within(sources).getByText('a0000000-0000-4000-8000-000000000008')).toBeInTheDocument()
  expect(within(sources).getByText('a0000000-0000-4000-8000-000000000007')).toBeInTheDocument()
  setDebugMode(false)
  expect(client.start).not.toHaveBeenCalled()
  expect(client.answer).not.toHaveBeenCalled()
})

test('stale running input exposes its exact cancel action, while explicit false suppresses legacy fallback', async () => {
  const user = userEvent.setup()
  const client = clientFixture()
  const stale: ProcessingSnapshotDto = structuredClone(snapshot)
  stale.jobs[0].state = 'superseded'
  stale.jobs[0].can_cancel = true
  stale.jobs[0].questions = []
  client.read.mockResolvedValue(stale)
  const mounted = mount(client)
  const cancel = await screen.findByRole('button', { name: 'Cancel this attempt' })
  await waitFor(() => expect(cancel).toBeEnabled())
  await user.click(cancel)
  await waitFor(() => expect(client.cancel).toHaveBeenCalledTimes(1))
  expect(client.cancel.mock.calls[0].slice(0, 3)).toEqual([
    batchId,
    jobId,
    { expected_revision: '2', attempt_id: attemptId },
  ])
  const noAction = structuredClone(stale)
  // A legacy state fallback would allow queued cancellation; explicit server false must win.
  noAction.jobs[0].state = 'queued'
  noAction.jobs[0].can_cancel = false
  await act(() =>
    mounted.cache.setQueryData(serverQueryKey(scope, 'processing', batchId), noAction),
  )
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Cancel this attempt' })).not.toBeInTheDocument(),
  )
  expect(client.cancel).toHaveBeenCalledTimes(1)
})

function mountView(
  client: ProcessingClient,
  view: 'overview' | 'examine' | 'inventory',
  sessionId?: string,
) {
  const queryClient = createServerQueryClient()

  const element = (session?: string) => (
    <ServerStateProvider scope={scope} client={queryClient}>
      <ProcessingWorkspace
        batch={batch}
        client={client}
        view={view}
        sessionId={session}
        navigate={vi.fn()}
        onDirtyChange={vi.fn()}
        onSaved={vi.fn().mockResolvedValue(undefined)}
      />
    </ServerStateProvider>
  )

  const mounted = render(element(sessionId))
  return {
    queryClient,
    rerenderWith: (session?: string) => mounted.rerender(element(session)),
  }
}

test('the fixture profile shows its jobs and questions by step, and claims no live session', async () => {
  mountView(clientFixture(), 'overview')
  const steps = await screen.findByRole('list', { name: 'Steps' })

  expect(within(steps).getByRole('link', { name: 'Examine · 0 of 1' })).toBeInTheDocument()
  expect(
    within(screen.getByRole('region', { name: 'Needs you' })).getByRole('link', {
      name: 'Answer: How many are in Packet A?',
    }),
  ).toHaveAttribute('href', `#${batchId}/processing/examine/${questionId}`)
  expect(screen.queryByRole('button', { name: /Open session/ })).not.toBeInTheDocument()
  cleanup()

  mountView(clientFixture(), 'examine')
  const outputs = await screen.findByRole('region', { name: 'Outputs' })
  expect(within(outputs).getAllByText(/Packet A/).length).toBeGreaterThan(0)
  expect(screen.queryByRole('button', { name: /Open session/ })).not.toBeInTheDocument()
})

test('a job with a session opens its timeline and chat in a drawer', async () => {
  const withSession: ProcessingSnapshotDto = {
    ...snapshot,
    jobs: [{ ...snapshot.jobs[0], session_state: 'waiting_input' }],
  }
  const session = vi.fn().mockResolvedValue({
    job_id: jobId,
    attempt_id: attemptId,
    session_state: 'waiting_input',
    outbox: [],
    inbox: [],
  })
  const client = {
    ...clientFixture(),
    read: vi.fn().mockResolvedValue(withSession),
    session,
    chat: vi.fn(),
  } as ProcessingClient
  mountView(client, 'examine')
  await userEvent.click(
    await screen.findByRole('button', { name: 'Open session: Examine · Packet A' }),
  )
  const drawer = screen.getByRole('dialog', { name: 'Examine · Packet A' })
  expect(
    within(drawer)
      .getByRole('heading', { name: 'Examine · Packet A' })
      .querySelector('[data-ai-mark]'),
  ).not.toBeNull()
  // Docked on the right, as on the canvas, rather than centred.
  expect(drawer).toHaveAttribute('data-placement', 'side')

  await waitFor(() => expect(session).toHaveBeenCalledWith(batchId, jobId))
  // Every session drawer answers its questions in place, not only Inventory's.
  expect(
    await within(drawer).findByRole('form', {
      name: 'Session question: How many are in Packet A?',
    }),
  ).toBeInTheDocument()
  await userEvent.click(within(drawer).getByRole('button', { name: 'Close' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('the Inventory drawer answers its open question through the question path', async () => {
  const user = userEvent.setup()
  const inventoryJob = {
    ...snapshot.jobs[0],
    stage: 'inventory' as const,
    session_state: 'waiting_input' as const,
    questions: [
      {
        ...snapshot.jobs[0].questions[0],
        assumption: 'Treating it as new until you say.',
        subject_id: subjectId,
        spec: {
          kind: 'clarification' as const,
          prompt: 'Is Packet A already in InvenTree?',
          reason: 'Stock #1712 has the same Part, date code and bin.',
        },
      },
    ],
  }
  const asked: ProcessingSnapshotDto = { ...snapshot, jobs: [inventoryJob] }
  const answered: ProcessingSnapshotDto = {
    ...asked,
    capture_revision: '9',
    jobs: [
      {
        ...inventoryJob,
        questions: [{ ...inventoryJob.questions[0], state: 'answered' as const }],
      },
    ],
  }
  validate('ProcessingSnapshot', asked)
  const read = vi.fn().mockResolvedValue(asked)
  const client = {
    ...clientFixture(),
    read,
    session: vi.fn().mockResolvedValue({
      job_id: jobId,
      attempt_id: attemptId,
      session_state: 'waiting_input',
      outbox: [],
      inbox: [],
    }),
    chat: vi.fn(),
  } as ProcessingClient
  mountView(client, 'inventory', jobId)
  const drawer = await screen.findByRole('dialog', { name: 'Inventory · Packet A' })
  const form = await within(drawer).findByRole('form', {
    name: 'Session question: Is Packet A already in InvenTree?',
  })
  expect(form).toHaveTextContent('Is Packet A already in InvenTree?')
  expect(within(drawer).getByRole('textbox', { name: 'Message this session' })).toBeVisible()

  await user.type(
    within(form).getByRole('textbox', { name: 'Clarification' }),
    'Different tube: add new stock',
  )
  read.mockResolvedValue(answered)
  await user.click(within(form).getByRole('button', { name: 'Send answer to the session' }))
  expect(client.answer).toHaveBeenCalledWith(
    batchId,
    questionId,
    expect.objectContaining({
      value: { kind: 'clarification', text: 'Different tube: add new stock' },
    }),
    expect.any(String),
  )
  await waitFor(() =>
    expect(within(drawer).queryByRole('form', { name: /^Session question/ })).toBeNull(),
  )
})

const secondQuestionId = 'e0000000-0000-4000-8000-00000000000e'

/** An Inventory session waiting on two clarifications about Packet A. */
function inventorySnapshot(captureRevision = '8', answeredIds: string[] = []) {
  const ask = (id: string, prompt: string) => ({
    ...snapshot.jobs[0].questions[0],
    id,
    state: answeredIds.includes(id) ? ('answered' as const) : ('open' as const),
    assumption: 'Treating it as new until you say.',
    subject_id: subjectId,
    spec: {
      kind: 'clarification' as const,
      prompt,
      reason: 'Stock #1712 has the same Part, date code and bin.',
    },
  })

  const value: ProcessingSnapshotDto = {
    ...snapshot,
    capture_revision: captureRevision,
    jobs: [
      {
        ...snapshot.jobs[0],
        stage: 'inventory',
        session_state: 'waiting_input',
        questions: [
          ask(questionId, 'Is Packet A already in InvenTree?'),
          ask(secondQuestionId, 'Is Packet A the reel in drawer 2?'),
        ],
      },
    ],
  }
  validate('ProcessingSnapshot', value)
  return value
}

function subscribeHash(listener: () => void) {
  addEventListener('hashchange', listener)
  return () => removeEventListener('hashchange', listener)
}

/**
 * Stands in for Batch: Processing remounts on every save, keyed as Batch keys it, and reads its
 * session link from the URL; the drawer restore store lives above that key.
 */
/** How the harness's reload behaves; a failed reload in Batch leaves Processing mounted. */
type ReloadControl = { remount: boolean }

function RemountingWorkspace({
  client,
  dirty,
  pinnedQuestionId,
  reload,
  drawerRestore,
}: {
  client: ProcessingClient
  dirty: (value: boolean) => void
  pinnedQuestionId?: string
  reload: ReloadControl
  drawerRestore: DrawerRestoreStore
}) {
  const [reset, setReset] = useState(0)
  const [shown, setShown] = useState(true)
  const hash = useSyncExternalStore(subscribeHash, () => location.hash)
  const sessionId = new URLSearchParams(hash.split('?')[1] ?? '').get('session')

  // As Batch's reload: only a reload that re-keys Processing carries the drawer across.
  async function onSaved() {
    if (reload.remount) {
      drawerRestore.carry()
      setReset((count) => count + 1)
    }
  }

  return (
    <>
      {/* Leaving Processing and coming back, as another batch tab would. */}
      <button type="button" onClick={() => setShown((value) => !value)}>
        Toggle Processing
      </button>
      {shown && (
        <ProcessingWorkspace
          key={`${batch.id}:${batch.revision}:${reset}`}
          batch={batch}
          client={client}
          view="inventory"
          sessionId={sessionId}
          questionId={pinnedQuestionId}
          navigate={vi.fn()}
          onDirtyChange={dirty}
          onSaved={onSaved}
          drawerRestore={drawerRestore}
        />
      )}
    </>
  )
}

/** Opens the Inventory drawer from a session link unless `fromRow` leaves it to the session row. */
// Stands in for leaving Processing from another tab, so the open drawer doesn't block it.
function toggleProcessing() {
  fireEvent.click(screen.getByRole('button', { name: 'Toggle Processing', hidden: true }))
}

function mountInventoryDrawer(
  read: ProcessingSnapshotDto,
  pinnedQuestionId?: string,
  { fromRow = false } = {},
) {
  history.replaceState(
    null,
    '',
    `#${batchId}/processing/inventory${fromRow ? '' : `?session=${jobId}`}`,
  )
  const client = {
    ...clientFixture(),
    read: vi.fn().mockResolvedValue(read),
    session: vi.fn().mockResolvedValue({
      job_id: jobId,
      attempt_id: attemptId,
      session_state: 'waiting_input',
      outbox: [],
      inbox: [],
    }),
    chat: vi.fn(),
  } satisfies ProcessingClient
  const cache = createServerQueryClient()
  cache.setDefaultOptions({
    queries: { ...cache.getDefaultOptions().queries, networkMode: 'online' },
  })
  const dirty = vi.fn()
  const reload: ReloadControl = { remount: true }
  // Batch's store, above Processing's key; a test can reload from another tab through it.
  const drawerRestore = createDrawerRestore()
  render(
    <ServerStateProvider scope={scope} client={cache}>
      <RemountingWorkspace
        client={client}
        dirty={dirty}
        pinnedQuestionId={pinnedQuestionId}
        reload={reload}
        drawerRestore={drawerRestore}
      />
    </ServerStateProvider>,
  )
  return {
    client,
    cache,
    dirty,
    reload,
    drawerRestore,
    key: serverQueryKey(scope, 'processing', batchId),
  }
}

const answerBox = (prompt: string) =>
  within(screen.getByRole('form', { name: `Session question: ${prompt}` })).getByRole('textbox', {
    name: 'Clarification',
  })

test('a failed or paused read keeps a drawer answer’s draft and its guard', async () => {
  const user = userEvent.setup()
  const { client, cache, dirty, key } = mountInventoryDrawer(inventorySnapshot())
  await screen.findByRole('dialog', { name: 'Inventory · Packet A' })
  await screen.findByRole('form', { name: /^Session question: Is Packet A already/ })
  await user.type(answerBox('Is Packet A already in InvenTree?'), 'Different tube')
  expect(dirty).toHaveBeenLastCalledWith(true)

  client.read.mockRejectedValueOnce(new Error('read_unavailable'))
  await act(async () => {
    await cache.refetchQueries({ queryKey: key })
  })
  expect(await screen.findByText(/Processing status unavailable/)).toBeInTheDocument()
  expect(answerBox('Is Packet A already in InvenTree?')).toHaveValue('Different tube')

  const resumed = deferredRead()
  client.read.mockReturnValueOnce(resumed.promise)
  act(() => {
    onlineManager.setOnline(false)
    void cache.invalidateQueries({ queryKey: key })
  })
  await waitFor(() => expect(cache.getQueryState(key)?.fetchStatus).toBe('paused'))
  expect(answerBox('Is Packet A already in InvenTree?')).toHaveValue('Different tube')
  act(() => {
    onlineManager.setOnline(true)
  })
  await act(async () => {
    resumed.resolve(inventorySnapshot())
    await resumed.promise
  })
  expect(answerBox('Is Packet A already in InvenTree?')).toHaveValue('Different tube')
  expect(dirty).toHaveBeenLastCalledWith(true)
})

test('closing the drawer with an unsaved answer asks first, and discards only on request', async () => {
  const user = userEvent.setup()
  const { dirty } = mountInventoryDrawer(inventorySnapshot())
  const drawer = await screen.findByRole('dialog', { name: 'Inventory · Packet A' })
  await within(drawer).findByRole('form', { name: /^Session question: Is Packet A already/ })
  await user.type(answerBox('Is Packet A already in InvenTree?'), 'Different tube')

  await user.click(within(drawer).getByRole('button', { name: 'Close' }))
  expect(within(drawer).getByRole('alert')).toHaveTextContent(
    'Save or discard your answer before closing this session.',
  )
  expect(answerBox('Is Packet A already in InvenTree?')).toHaveValue('Different tube')
  expect(dirty).toHaveBeenLastCalledWith(true)

  await user.click(within(drawer).getByRole('button', { name: 'Discard answer and close' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(dirty).toHaveBeenLastCalledWith(false)
})

// The dimmed page beside the drawer is its backdrop, rendered just before it. Radix starts
// listening for outside presses a tick after the drawer opens.
async function clickBesideDrawer(user: ReturnType<typeof userEvent.setup>, drawer: HTMLElement) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  const backdrop = drawer.previousElementSibling
  if (!(backdrop instanceof HTMLElement)) {
    throw new Error('the drawer has no backdrop')
  }
  await user.click(backdrop)
}

test('a click beside the drawer closes it and returns focus to its session row', async () => {
  const user = userEvent.setup()
  mountInventoryDrawer(inventorySnapshot(), undefined, { fromRow: true })
  await user.click(
    await screen.findByRole('button', { name: 'Open session: Inventory · Packet A' }),
  )
  const drawer = await screen.findByRole('dialog', { name: 'Inventory · Packet A' })

  await clickBesideDrawer(user, drawer)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Open session: Inventory · Packet A' })).toHaveFocus()
})

test('a click beside the drawer with an unsaved answer asks first, as Close does', async () => {
  const user = userEvent.setup()
  const { dirty } = mountInventoryDrawer(inventorySnapshot())
  const drawer = await screen.findByRole('dialog', { name: 'Inventory · Packet A' })
  await within(drawer).findByRole('form', { name: /^Session question: Is Packet A already/ })
  await user.type(answerBox('Is Packet A already in InvenTree?'), 'Different tube')

  await clickBesideDrawer(user, drawer)
  expect(screen.getByRole('dialog', { name: 'Inventory · Packet A' })).toBeInTheDocument()
  expect(within(drawer).getByRole('alert')).toHaveTextContent(
    'Save or discard your answer before closing this session.',
  )
  expect(answerBox('Is Packet A already in InvenTree?')).toHaveValue('Different tube')
  expect(dirty).toHaveBeenLastCalledWith(true)
})

test('answering one drawer question leaves the other answerable, and focus moves to it', async () => {
  const user = userEvent.setup()
  // Opened from a session link; saving the answer remounts Processing, as Batch does.
  const { client } = mountInventoryDrawer(inventorySnapshot())
  const drawer = await screen.findByRole('dialog', { name: 'Inventory · Packet A' })
  await within(drawer).findByRole('form', { name: /^Session question: Is Packet A already/ })
  // A /1 question carries no options, so no placeholder cards stand in for them.
  expect(within(drawer).queryByRole('radiogroup', { name: /^Answer options/ })).toBeNull()

  const first = 'Is Packet A already in InvenTree?'
  const second = 'Is Packet A the reel in drawer 2?'
  await user.type(answerBox(first), 'Different tube')
  await user.type(answerBox(second), 'No')

  // Saving one answer reloads Processing, so neither saves while the other has a draft.
  const send = (prompt: string) =>
    within(screen.getByRole('form', { name: `Session question: ${prompt}` })).getByRole('button', {
      name: 'Send answer to the session',
    })

  expect(send(first)).toBeDisabled()
  expect(screen.getByRole('form', { name: `Session question: ${first}` })).toHaveTextContent(
    'Save or discard the other answer first',
  )
  await user.click(
    within(screen.getByRole('form', { name: `Session question: ${second}` })).getByRole('button', {
      name: 'Discard unsaved answer',
    }),
  )
  expect(send(first)).toBeEnabled()

  client.read.mockResolvedValue(inventorySnapshot('9', [questionId]))
  await user.click(send(first))
  expect(client.answer).toHaveBeenCalledWith(
    batchId,
    questionId,
    expect.objectContaining({ expected_capture_revision: '8' }),
    expect.any(String),
  )
  await waitFor(() =>
    expect(screen.queryByRole('form', { name: `Session question: ${first}` })).toBeNull(),
  )
  await waitFor(() => expect(answerBox(second)).toHaveFocus())

  // The other form follows the new capture revision instead of reading as superseded.
  const form = screen.getByRole('form', { name: `Session question: ${second}` })
  expect(form).not.toHaveTextContent('superseded')
  await user.type(answerBox(second), 'No, it is new')
  await user.click(send(second))
  expect(client.answer).toHaveBeenLastCalledWith(
    batchId,
    secondQuestionId,
    expect.objectContaining({ expected_capture_revision: '9' }),
    expect.any(String),
  )
})

test('a drawer draft survives its question being answered elsewhere', async () => {
  const user = userEvent.setup()
  const { client, cache, dirty, key } = mountInventoryDrawer(inventorySnapshot())
  const drawer = await screen.findByRole('dialog', { name: 'Inventory · Packet A' })
  await within(drawer).findByRole('form', { name: /^Session question: Is Packet A already/ })
  await user.type(answerBox('Is Packet A already in InvenTree?'), 'Different tube')

  client.read.mockResolvedValue(inventorySnapshot('9', [questionId]))
  await act(async () => {
    await cache.refetchQueries({ queryKey: key })
  })
  const form = screen.getByRole('form', {
    name: 'Session question: Is Packet A already in InvenTree?',
  })
  await waitFor(() =>
    expect(form).toHaveTextContent('This question is superseded or its saved context changed'),
  )
  expect(answerBox('Is Packet A already in InvenTree?')).toHaveValue('Different tube')
  expect(dirty).toHaveBeenLastCalledWith(true)
  await user.click(within(drawer).getByRole('button', { name: 'Close' }))
  expect(within(drawer).getByRole('alert')).toHaveTextContent('Save or discard your answer')

  // Discarding the draft lets the answered question's form go.
  await user.click(within(form).getByRole('button', { name: 'Discard unsaved answer' }))
  await waitFor(() =>
    expect(
      screen.queryByRole('form', { name: 'Session question: Is Packet A already in InvenTree?' }),
    ).toBeNull(),
  )
})

test('a drawer draft survives its session leaving the read', async () => {
  const user = userEvent.setup()
  history.replaceState(null, '', `#${batchId}/processing/inventory?session=${jobId}`)
  const { client, cache, dirty, key } = mountInventoryDrawer(inventorySnapshot())
  const drawer = await screen.findByRole('dialog', { name: 'Inventory · Packet A' })
  await within(drawer).findByRole('form', { name: /^Session question: Is Packet A already/ })
  await user.type(answerBox('Is Packet A already in InvenTree?'), 'Different tube')
  // The session row is behind the open drawer, so hidden from the accessibility tree.
  expect(
    screen.getByRole('button', { name: 'Open session: Inventory · Packet A', hidden: true }),
  ).toBeInTheDocument()

  const gone = inventorySnapshot('9')
  delete gone.jobs[0].session_state
  client.read.mockResolvedValue(gone)
  await act(async () => {
    await cache.refetchQueries({ queryKey: key })
  })
  // The session row leaves the step page once the read without the session is shown.
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'Open session: Inventory · Packet A', hidden: true }),
    ).not.toBeInTheDocument(),
  )
  expect(screen.getByRole('dialog', { name: 'Inventory · Packet A' })).toBeInTheDocument()
  expect(answerBox('Is Packet A already in InvenTree?')).toHaveValue('Different tube')
  expect(dirty).toHaveBeenLastCalledWith(true)

  // Discarding the last draft closes the kept drawer for good, including its session link.
  await user.click(screen.getByRole('button', { name: 'Discard unsaved answer' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(location.hash).not.toContain('session=')
  client.read.mockResolvedValue(inventorySnapshot('9'))
  await act(async () => {
    await cache.refetchQueries({ queryKey: key })
  })
  await screen.findByRole('button', { name: 'Open session: Inventory · Packet A' })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('the drawer’s link to the page’s question asks first while a drawer answer is unsaved', async () => {
  const user = userEvent.setup()
  const { dirty } = mountInventoryDrawer(inventorySnapshot(), questionId)
  const drawer = await screen.findByRole('dialog', { name: 'Inventory · Packet A' })
  const second = 'Is Packet A the reel in drawer 2?'
  await within(drawer).findByRole('form', { name: `Session question: ${second}` })
  await user.type(answerBox(second), 'No')

  await user.click(within(drawer).getByRole('link', { name: 'Is Packet A already in InvenTree?' }))
  expect(screen.getByRole('dialog', { name: 'Inventory · Packet A' })).toBeInTheDocument()
  expect(within(drawer).getByRole('alert')).toHaveTextContent('Save or discard your answer')
  expect(answerBox(second)).toHaveValue('No')
  expect(dirty).toHaveBeenLastCalledWith(true)
})

test('a drawer draft keeps its revision when another answer moves it, and reads as superseded', async () => {
  const user = userEvent.setup()
  const { client, cache, dirty, key } = mountInventoryDrawer(inventorySnapshot())
  const first = 'Is Packet A already in InvenTree?'
  await screen.findByRole('form', { name: `Session question: ${first}` })
  await user.type(answerBox(first), 'Different tube')

  client.read.mockResolvedValue(inventorySnapshot('9', [secondQuestionId]))
  await act(async () => {
    await cache.refetchQueries({ queryKey: key })
  })
  const form = screen.getByRole('form', { name: `Session question: ${first}` })
  await waitFor(() =>
    expect(form).toHaveTextContent('This question is superseded or its saved context changed'),
  )
  expect(answerBox(first)).toHaveValue('Different tube')
  expect(dirty).toHaveBeenLastCalledWith(true)
})

test('other drawer forms are read-only while an answer saves', async () => {
  const user = userEvent.setup()
  const { client } = mountInventoryDrawer(inventorySnapshot())
  await screen.findByRole('form', { name: /^Session question: Is Packet A already/ })

  let finish: () => void = () => undefined

  client.answer.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = () =>
        resolve({
          answer_id: 'c0000000-0000-4000-8000-000000000003',
          question_id: questionId,
          attempt_id: attemptId,
          capture_revision: '9',
          command_id: 'd0000000-0000-4000-8000-000000000004',
        })
    }),
  )
  await user.type(answerBox('Is Packet A already in InvenTree?'), 'Different tube')
  await user.click(
    within(
      screen.getByRole('form', { name: 'Session question: Is Packet A already in InvenTree?' }),
    ).getByRole('button', { name: 'Send answer to the session' }),
  )
  await waitFor(() => expect(answerBox('Is Packet A the reel in drawer 2?')).toBeDisabled())
  client.read.mockResolvedValue(inventorySnapshot('9', [questionId]))
  await act(async () => {
    finish()
  })
  await waitFor(() => expect(answerBox('Is Packet A the reel in drawer 2?')).toBeEnabled())
})

test('the page’s clean pinned answer follows a revision a drawer answer moved', async () => {
  const user = userEvent.setup()
  const { client } = mountInventoryDrawer(inventorySnapshot(), questionId)
  await screen.findByRole('form', { name: 'Pinned application question', hidden: true })
  const second = 'Is Packet A the reel in drawer 2?'
  await screen.findByRole('form', { name: `Session question: ${second}` })
  await user.type(answerBox(second), 'No')
  client.read.mockResolvedValue(inventorySnapshot('9', [secondQuestionId]))
  await user.click(
    within(screen.getByRole('form', { name: `Session question: ${second}` })).getByRole('button', {
      name: 'Send answer to the session',
    }),
  )
  await waitFor(() =>
    expect(screen.queryByRole('form', { name: `Session question: ${second}` })).toBeNull(),
  )

  // The page behind the drawer is inert, so the drawer closes first.
  await user.click(
    within(screen.getByRole('dialog', { name: 'Inventory · Packet A' })).getByRole('button', {
      name: 'Close',
    }),
  )
  const pinned = screen.getByRole('form', { name: 'Pinned application question' })
  expect(pinned).not.toHaveTextContent('superseded')
  await user.type(within(pinned).getByRole('textbox', { name: 'Clarification' }), 'Same tube')
  await user.click(within(pinned).getByRole('button', { name: 'Send answer to the session' }))
  expect(client.answer).toHaveBeenLastCalledWith(
    batchId,
    questionId,
    expect.objectContaining({ expected_capture_revision: '9' }),
    expect.any(String),
  )
})

test('a drawer opened from the session row stays open after an answer, focused on the next', async () => {
  const user = userEvent.setup()
  const { client } = mountInventoryDrawer(inventorySnapshot(), undefined, { fromRow: true })
  await user.click(
    await screen.findByRole('button', { name: 'Open session: Inventory · Packet A' }),
  )
  const first = 'Is Packet A already in InvenTree?'
  const second = 'Is Packet A the reel in drawer 2?'
  await screen.findByRole('form', { name: `Session question: ${first}` })
  await user.type(answerBox(first), 'Different tube')
  client.read.mockResolvedValue(inventorySnapshot('9', [questionId]))
  await user.click(
    within(screen.getByRole('form', { name: `Session question: ${first}` })).getByRole('button', {
      name: 'Send answer to the session',
    }),
  )

  await waitFor(() => expect(answerBox(second)).toHaveFocus())
  expect(screen.getByRole('dialog', { name: 'Inventory · Packet A' })).toBeInTheDocument()
  expect(screen.queryByRole('form', { name: `Session question: ${first}` })).toBeNull()
})

test('a skipped reload leaves nothing to reopen the drawer on a later visit', async () => {
  const user = userEvent.setup()
  const { client, reload } = mountInventoryDrawer(inventorySnapshot(), undefined, {
    fromRow: true,
  })
  reload.remount = false
  await user.click(
    await screen.findByRole('button', { name: 'Open session: Inventory · Packet A' }),
  )
  const first = 'Is Packet A already in InvenTree?'
  await screen.findByRole('form', { name: `Session question: ${first}` })
  await user.type(answerBox(first), 'Different tube')
  client.read.mockResolvedValue(inventorySnapshot('9', [questionId]))
  await user.click(
    within(screen.getByRole('form', { name: `Session question: ${first}` })).getByRole('button', {
      name: 'Send answer to the session',
    }),
  )
  await waitFor(() =>
    expect(screen.queryByRole('form', { name: `Session question: ${first}` })).toBeNull(),
  )

  // Leave Processing with the drawer open, then come back: it starts from its route alone.
  toggleProcessing()
  toggleProcessing()
  await screen.findByRole('button', { name: 'Open session: Inventory · Packet A' })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('an answer’s failed reload leaves nothing for another tab’s reload to carry', async () => {
  const user = userEvent.setup()
  const { client, reload, drawerRestore } = mountInventoryDrawer(inventorySnapshot(), undefined, {
    fromRow: true,
  })
  reload.remount = false
  await user.click(
    await screen.findByRole('button', { name: 'Open session: Inventory · Packet A' }),
  )
  const first = 'Is Packet A already in InvenTree?'
  await screen.findByRole('form', { name: `Session question: ${first}` })
  await user.type(answerBox(first), 'Different tube')
  client.read.mockResolvedValue(inventorySnapshot('9', [questionId]))
  await user.click(
    within(screen.getByRole('form', { name: `Session question: ${first}` })).getByRole('button', {
      name: 'Send answer to the session',
    }),
  )
  await waitFor(() =>
    expect(screen.queryByRole('form', { name: `Session question: ${first}` })).toBeNull(),
  )

  // Off to Records, whose save reloads the batch and re-keys every stage, then back.
  toggleProcessing()
  act(() => drawerRestore.carry())
  toggleProcessing()
  await screen.findByRole('button', { name: 'Open session: Inventory · Packet A' })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('focus the operator moves while the remount’s read is still pending stays where they put it', async () => {
  const user = userEvent.setup()
  const { client } = mountInventoryDrawer(inventorySnapshot(), undefined, { fromRow: true })
  await user.click(
    await screen.findByRole('button', { name: 'Open session: Inventory · Packet A' }),
  )
  const first = 'Is Packet A already in InvenTree?'
  await screen.findByRole('form', { name: `Session question: ${first}` })
  await user.type(answerBox(first), 'Different tube')
  // The answer's own refresh succeeds; the remounted Processing's first read is slow.
  const slow = deferredRead()
  client.read
    .mockResolvedValueOnce(inventorySnapshot('9', [questionId]))
    .mockReturnValueOnce(slow.promise)
    .mockResolvedValue(inventorySnapshot('9', [questionId]))
  await user.click(
    within(screen.getByRole('form', { name: `Session question: ${first}` })).getByRole('button', {
      name: 'Send answer to the session',
    }),
  )
  const chat = await screen.findByRole('textbox', { name: 'Message this session' })
  chat.focus()

  await act(async () => {
    slow.resolve(inventorySnapshot('9', [questionId]))
    await slow.promise
  })
  await screen.findByRole('form', { name: 'Session question: Is Packet A the reel in drawer 2?' })
  expect(chat).toHaveFocus()
})

test('focus the operator moves while the remount’s read fails stays where they put it', async () => {
  const user = userEvent.setup()
  const { client, cache, key } = mountInventoryDrawer(inventorySnapshot(), undefined, {
    fromRow: true,
  })
  await user.click(
    await screen.findByRole('button', { name: 'Open session: Inventory · Packet A' }),
  )
  const first = 'Is Packet A already in InvenTree?'
  await screen.findByRole('form', { name: `Session question: ${first}` })
  await user.type(answerBox(first), 'Different tube')
  // The answer's own refresh succeeds; the remounted Processing's first read fails.
  client.read
    .mockResolvedValueOnce(inventorySnapshot('9', [questionId]))
    .mockRejectedValueOnce(new Error('read_unavailable'))
    .mockResolvedValue(inventorySnapshot('9', [questionId]))
  await user.click(
    within(screen.getByRole('form', { name: `Session question: ${first}` })).getByRole('button', {
      name: 'Send answer to the session',
    }),
  )
  expect(await screen.findByText(/Processing status unavailable/)).toBeInTheDocument()
  const chat = await screen.findByRole('textbox', { name: 'Message this session' })
  chat.focus()

  await act(async () => {
    await cache.refetchQueries({ queryKey: key })
  })
  await screen.findByRole('form', { name: 'Session question: Is Packet A the reel in drawer 2?' })
  expect(chat).toHaveFocus()
})

/** Answers the first question from a drawer opened on the session row, remounting Processing. */
async function answerFirstFromRow(user: ReturnType<typeof userEvent.setup>) {
  const mounted = mountInventoryDrawer(inventorySnapshot(), undefined, { fromRow: true })
  await user.click(
    await screen.findByRole('button', { name: 'Open session: Inventory · Packet A' }),
  )
  const first = 'Is Packet A already in InvenTree?'
  await screen.findByRole('form', { name: `Session question: ${first}` })
  await user.type(answerBox(first), 'Different tube')
  mounted.client.read.mockResolvedValue(inventorySnapshot('9', [questionId]))
  await user.click(
    within(screen.getByRole('form', { name: `Session question: ${first}` })).getByRole('button', {
      name: 'Send answer to the session',
    }),
  )
  return mounted
}

test('closing a drawer restored after a remount returns focus to its session row', async () => {
  const user = userEvent.setup()
  await answerFirstFromRow(user)
  await waitFor(() => expect(answerBox('Is Packet A the reel in drawer 2?')).toHaveFocus())

  await user.click(
    within(screen.getByRole('dialog', { name: 'Inventory · Packet A' })).getByRole('button', {
      name: 'Close',
    }),
  )
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Open session: Inventory · Packet A' })).toHaveFocus()
})

test('a drawer that focuses its own Close on opening still moves to the next question', async () => {
  const user = userEvent.setup()
  const { client } = mountInventoryDrawer(inventorySnapshot(), undefined, { fromRow: true })
  await user.click(
    await screen.findByRole('button', { name: 'Open session: Inventory · Packet A' }),
  )
  // Opening places focus on the drawer's first control, its Close button.
  const drawer = screen.getByRole('dialog', { name: 'Inventory · Packet A' })
  expect(within(drawer).getByRole('button', { name: 'Close' })).toHaveFocus()

  const first = 'Is Packet A already in InvenTree?'
  await screen.findByRole('form', { name: `Session question: ${first}` })
  await user.type(answerBox(first), 'Different tube')
  client.read.mockResolvedValue(inventorySnapshot('9', [questionId]))
  // Saving remounts Processing, and the restored drawer again focuses its Close on opening.
  await user.click(
    within(screen.getByRole('form', { name: `Session question: ${first}` })).getByRole('button', {
      name: 'Send answer to the session',
    }),
  )
  await waitFor(() => expect(answerBox('Is Packet A the reel in drawer 2?')).toHaveFocus())
})

test('saving a drawer’s last draft after its session left clears the session link', async () => {
  const user = userEvent.setup()
  const { client, cache, key } = mountInventoryDrawer(inventorySnapshot())
  const first = 'Is Packet A already in InvenTree?'
  await screen.findByRole('form', { name: `Session question: ${first}` })
  await user.type(answerBox(first), 'Different tube')
  expect(
    screen.getByRole('button', { name: 'Open session: Inventory · Packet A', hidden: true }),
  ).toBeInTheDocument()

  // The session ends; its question is still open at the same capture revision.
  const ended = inventorySnapshot('8')
  delete ended.jobs[0].session_state
  client.read.mockResolvedValue(ended)
  await act(async () => {
    await cache.refetchQueries({ queryKey: key })
  })
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'Open session: Inventory · Packet A', hidden: true }),
    ).not.toBeInTheDocument(),
  )
  const answered = inventorySnapshot('9', [questionId])
  delete answered.jobs[0].session_state
  client.read.mockResolvedValue(answered)
  await user.click(
    within(screen.getByRole('form', { name: `Session question: ${first}` })).getByRole('button', {
      name: 'Send answer to the session',
    }),
  )
  expect(client.answer).toHaveBeenCalled()
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(location.hash).not.toContain('session=')
})

test('a drawer with no draft closes at once when its session leaves, clearing its link', async () => {
  const { client, cache, key } = mountInventoryDrawer(inventorySnapshot())
  await screen.findByRole('form', { name: /^Session question: Is Packet A already/ })
  const gone = inventorySnapshot('9')
  delete gone.jobs[0].session_state
  client.read.mockResolvedValue(gone)
  await act(async () => {
    await cache.refetchQueries({ queryKey: key })
  })
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(location.hash).not.toContain('session=')
})

test('a session that leaves a second time has its link cleared again', async () => {
  const { client, cache, key } = mountInventoryDrawer(inventorySnapshot())
  await screen.findByRole('dialog', { name: 'Inventory · Packet A' })
  const gone = inventorySnapshot('9')
  delete gone.jobs[0].session_state

  for (let round = 1; round <= 2; round += 1) {
    client.read.mockResolvedValue(gone)
    await act(async () => {
      await cache.refetchQueries({ queryKey: key })
    })
    await waitFor(() => expect(location.hash).not.toContain('session='))
    // The session comes back and its link is followed again.
    client.read.mockResolvedValue(inventorySnapshot('9'))
    await act(async () => {
      await cache.refetchQueries({ queryKey: key })
      location.hash = `${batchId}/processing/inventory?session=${jobId}`
    })
    await screen.findByRole('dialog', { name: 'Inventory · Packet A' })
  }
})

test('a session link opens its drawer on arrival', async () => {
  const client = {
    ...clientFixture(),
    read: vi.fn().mockResolvedValue({
      ...snapshot,
      jobs: [{ ...snapshot.jobs[0], session_state: 'waiting_input' }],
    }),
    session: vi.fn().mockResolvedValue({
      job_id: jobId,
      attempt_id: attemptId,
      session_state: 'waiting_input',
      outbox: [],
      inbox: [],
    }),
    chat: vi.fn(),
  } as ProcessingClient
  history.replaceState(null, '', `#${batchId}/processing/examine?session=${jobId}`)
  mountView(client, 'examine', jobId)
  const drawer = await screen.findByRole('dialog', { name: 'Examine · Packet A' })
  expect(drawer).toBeVisible()
  // Closing drops the link's query, so a later reload does not reopen the drawer.
  await userEvent.click(within(drawer).getByRole('button', { name: 'Close' }))
  expect(location.hash).toBe(`#${batchId}/processing/examine`)
})

test('a session link followed while Processing is open opens that drawer', async () => {
  const client = {
    ...clientFixture(),
    read: vi.fn().mockResolvedValue({
      ...snapshot,
      jobs: [{ ...snapshot.jobs[0], session_state: 'waiting_input' }],
    }),
    session: vi.fn().mockResolvedValue({
      job_id: jobId,
      attempt_id: attemptId,
      session_state: 'waiting_input',
      outbox: [],
      inbox: [],
    }),
    chat: vi.fn(),
  } as ProcessingClient
  const view = mountView(client, 'examine')
  await screen.findByRole('button', { name: 'Open session: Examine · Packet A' })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  view.rerenderWith(jobId)
  expect(await screen.findByRole('dialog', { name: 'Examine · Packet A' })).toBeVisible()
})

test('with both drafts open, neither can save until the other is saved or discarded', async () => {
  const dirty = vi.fn()
  const instruct = vi.fn().mockResolvedValue(undefined)
  render(
    <ServerStateProvider scope={scope} client={createServerQueryClient()}>
      <ProcessingWorkspace
        batch={batch}
        client={clientFixture()}
        view="overview"
        questionId={questionId}
        navigate={vi.fn()}
        onDirtyChange={dirty}
        onSaved={vi.fn().mockResolvedValue(undefined)}
        instructions={{ text: '', instruct }}
      />
    </ServerStateProvider>,
  )
  const form = await screen.findByRole('form', { name: 'Pinned application question' })
  await userEvent.type(within(form).getByLabelText('Quantity'), '51')
  await userEvent.type(screen.getByLabelText('Instructions for the whole batch'), 'Keep apart')

  // Saving either reloads Processing, which would drop the other draft.
  expect(screen.getByRole('button', { name: 'Save instructions' })).toBeDisabled()
  expect(screen.getByText(/Save or discard the answer first/)).toBeInTheDocument()
  expect(
    within(form).getByRole('button', { name: 'Save answer and queue continuation' }),
  ).toBeDisabled()
  expect(screen.getByText(/Save or discard the batch instructions first/)).toBeInTheDocument()

  await userEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
  expect(
    within(form).getByRole('button', { name: 'Save answer and queue continuation' }),
  ).toBeEnabled()
  expect(screen.queryByText(/Save or discard the batch instructions first/)).not.toBeInTheDocument()
  expect(dirty).toHaveBeenLastCalledWith(true)
  expect(instruct).not.toHaveBeenCalled()
})

test('a step with no retained work has no empty outputs region', async () => {
  render(
    <ServerStateProvider scope={scope} client={createServerQueryClient()}>
      <ProcessingWorkspace
        batch={batch}
        client={clientFixture()}
        view="research"
        navigate={vi.fn()}
        onDirtyChange={vi.fn()}
        onSaved={vi.fn().mockResolvedValue(undefined)}
      />
    </ServerStateProvider>,
  )

  expect(await screen.findByText('No work yet')).toBeInTheDocument()
  expect(screen.queryByRole('region', { name: 'Outputs' })).not.toBeInTheDocument()
})

test('the drawer closes when its link points at the question already open', async () => {
  const withSession: ProcessingSnapshotDto = {
    ...snapshot,
    jobs: [{ ...snapshot.jobs[0], session_state: 'waiting_input' }],
  }
  const client = {
    ...clientFixture(),
    read: vi.fn().mockResolvedValue(withSession),
    session: vi.fn().mockResolvedValue({
      job_id: jobId,
      attempt_id: attemptId,
      session_state: 'waiting_input',
      outbox: [],
      inbox: [],
    }),
    chat: vi.fn(),
  } as ProcessingClient
  render(
    <ServerStateProvider scope={scope} client={createServerQueryClient()}>
      <ProcessingWorkspace
        batch={batch}
        client={client}
        view="examine"
        questionId={questionId}
        navigate={vi.fn()}
        onDirtyChange={vi.fn()}
        onSaved={vi.fn().mockResolvedValue(undefined)}
      />
    </ServerStateProvider>,
  )
  await userEvent.click(
    await screen.findByRole('button', { name: 'Open session: Examine · Packet A' }),
  )
  const drawer = screen.getByRole('dialog', { name: 'Examine · Packet A' })
  await userEvent.click(within(drawer).getByRole('link', { name: 'How many are in Packet A?' }))

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('while one draft saves and Processing reloads, the other cannot be edited', async () => {
  let finishInstructions: () => void = () => undefined

  let finishReload: () => void = () => undefined

  const instruct = vi.fn(
    () => new Promise<void>((resolve) => (finishInstructions = () => resolve())),
  )
  const client = clientFixture()
  render(
    <ServerStateProvider scope={scope} client={createServerQueryClient()}>
      <ProcessingWorkspace
        batch={batch}
        client={client}
        view="overview"
        questionId={questionId}
        navigate={vi.fn()}
        onDirtyChange={vi.fn()}
        onSaved={() => new Promise<void>((resolve) => (finishReload = () => resolve()))}
        instructions={{ text: '', instruct }}
      />
    </ServerStateProvider>,
  )
  const form = await screen.findByRole('form', { name: 'Pinned application question' })
  await userEvent.type(screen.getByLabelText('Instructions for the whole batch'), 'Keep apart')
  await userEvent.click(screen.getByRole('button', { name: 'Save instructions' }))
  expect(within(form).getByLabelText('Quantity')).toBeDisabled()
  await act(async () => finishInstructions())
  expect(within(form).getByLabelText('Quantity')).toBeEnabled()

  await userEvent.type(within(form).getByLabelText('Quantity'), '51')
  await userEvent.click(
    within(form).getByRole('button', { name: 'Save answer and queue continuation' }),
  )
  // The answer is saved and Processing is still reloading.
  await waitFor(() => expect(client.answer).toHaveBeenCalled())
  expect(screen.getByLabelText('Instructions for the whole batch')).toBeDisabled()
  await act(async () => finishReload())
  expect(screen.getByLabelText('Instructions for the whole batch')).toBeEnabled()
})

test('the drawer closes when its link moves from Overview to the step page', async () => {
  const withSession: ProcessingSnapshotDto = {
    ...snapshot,
    jobs: [{ ...snapshot.jobs[0], session_state: 'waiting_input' }],
  }
  const client = {
    ...clientFixture(),
    read: vi.fn().mockResolvedValue(withSession),
    session: vi.fn().mockResolvedValue({
      job_id: jobId,
      attempt_id: attemptId,
      session_state: 'waiting_input',
      outbox: [],
      inbox: [],
    }),
    chat: vi.fn(),
  } as ProcessingClient
  const cache = createServerQueryClient()
  const props = {
    batch,
    client,
    questionId,
    navigate: vi.fn(),
    onDirtyChange: vi.fn(),
    onSaved: vi.fn().mockResolvedValue(undefined),
  }
  const view = render(
    <ServerStateProvider scope={scope} client={cache}>
      <ProcessingWorkspace {...props} view="overview" />
    </ServerStateProvider>,
  )
  await userEvent.click(
    await screen.findByRole('button', { name: 'Open session: Examine · Packet A' }),
  )
  expect(screen.getByRole('dialog', { name: 'Examine · Packet A' })).toBeInTheDocument()

  // The link's route is the Examine step with the same question.
  view.rerender(
    <ServerStateProvider scope={scope} client={cache}>
      <ProcessingWorkspace {...props} view="examine" />
    </ServerStateProvider>,
  )
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('the batch is shown paused from its own read, whatever the account-wide list holds', async () => {
  const client = {
    ...clientFixture(),
    read: vi.fn().mockResolvedValue({
      ...snapshot,
      jobs: [{ ...snapshot.jobs[0], session_state: 'running' }],
      paused: true,
    }),
  }
  render(
    <ServerStateProvider scope={scope} client={createServerQueryClient()}>
      <ApiClientsProvider
        value={{
          agents: {
            sessions: vi.fn(async () => ({
              sessions: [],
              paused_batch_ids: [],
              paused_truncated: true as const,
              next_before: null,
              sessions_supported: true,
            })),
            settings: vi.fn(async () => agentSettings('1', null, { session_concurrency: 1 })),
            pause: vi.fn(async () => undefined),
          },
        }}
      >
        <ProcessingWorkspace
          batch={batch}
          client={client as ProcessingClient}
          view="overview"
          navigate={vi.fn()}
          onDirtyChange={vi.fn()}
          onSaved={vi.fn().mockResolvedValue(undefined)}
        />
      </ApiClientsProvider>
    </ServerStateProvider>,
  )
  expect(await screen.findByRole('button', { name: 'Resume' })).toBeVisible()
})

test('a question URL pins its first read without ever showing the question as unavailable', async () => {
  const added: string[] = []
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      record.addedNodes.forEach((node) => added.push(node.textContent ?? ''))
    }
  })
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  try {
    const client = clientFixture()
    const mounted = mount(client)
    expect(await screen.findByLabelText('Quantity')).toBeVisible()
    const newer = structuredClone(snapshot)
    newer.capture_revision = '9'
    client.read.mockResolvedValue(newer)
    await act(async () => {
      await mounted.cache.refetchQueries()
    })
    expect(screen.getByLabelText('Quantity')).toBeVisible()
    observer
      .takeRecords()
      .forEach((record) => record.addedNodes.forEach((node) => added.push(node.textContent ?? '')))
    expect(added.some((text) => text.includes('pinned question is unavailable'))).toBe(false)
  } finally {
    observer.disconnect()
  }
})

test('returning to a route reopens only the session its link names, not an earlier drawer', async () => {
  const withSession: ProcessingSnapshotDto = {
    ...snapshot,
    jobs: [{ ...snapshot.jobs[0], session_state: 'waiting_input' }],
  }
  const client = {
    ...clientFixture(),
    read: vi.fn().mockResolvedValue(withSession),
    session: vi.fn().mockResolvedValue({
      job_id: jobId,
      attempt_id: attemptId,
      session_state: 'waiting_input',
      outbox: [],
      inbox: [],
    }),
    chat: vi.fn(),
  } as ProcessingClient
  const cache = createServerQueryClient()
  const props = {
    batch,
    client,
    questionId,
    navigate: vi.fn(),
    onDirtyChange: vi.fn(),
    onSaved: vi.fn().mockResolvedValue(undefined),
  }
  const view = render(
    <ServerStateProvider scope={scope} client={cache}>
      <ProcessingWorkspace {...props} view="overview" />
    </ServerStateProvider>,
  )
  await userEvent.click(
    await screen.findByRole('button', { name: 'Open session: Examine · Packet A' }),
  )
  expect(screen.getByRole('dialog', { name: 'Examine · Packet A' })).toBeInTheDocument()

  // The link's route is the Examine step with the same question.
  view.rerender(
    <ServerStateProvider scope={scope} client={cache}>
      <ProcessingWorkspace {...props} view="examine" />
    </ServerStateProvider>,
  )
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  view.rerender(
    <ServerStateProvider scope={scope} client={cache}>
      <ProcessingWorkspace {...props} view="overview" />
    </ServerStateProvider>,
  )
  expect(screen.queryByRole('dialog', { name: 'Examine · Packet A' })).not.toBeInTheDocument()
})

/** An Inventory session waiting on one stepped question about Packet A. */
function steppedInventorySnapshot() {
  const value: ProcessingSnapshotDto = {
    ...snapshot,
    jobs: [
      {
        ...snapshot.jobs[0],
        stage: 'inventory',
        session_state: 'waiting_input',
        questions: [
          {
            id: questionId,
            job_id: jobId,
            attempt_id: attemptId,
            input_sha256: 'a'.repeat(64),
            revision: '1',
            state: 'open',
            subject_id: subjectId,
            schema_version: 'bench-intake-question/2',
            fields: ['identity'],
            title: 'Packet A and stock #1712',
            reason: 'Stock #1712 has the same Part, date code and bin.',
            steps: [
              {
                id: 'same_tube',
                prompt: 'Is Packet A the tube already in stock?',
                assumption: 'Treating it as new until you say.',
                answer: {
                  kind: 'choice',
                  options: [
                    { id: 'same', label: 'Same tube as stock #1712' },
                    { id: 'new', label: 'Different tube: add new stock' },
                  ],
                  other: false,
                },
              },
              {
                id: 'note',
                prompt: 'Anything to add?',
                assumption: 'Nothing to add.',
                answer: { kind: 'text' },
              },
            ],
          },
        ],
      },
    ],
  }
  validate('ProcessingSnapshot', value)
  return value
}

test('a stepped drawer question is answered with live option cards, and a refused step stays editable', async () => {
  const user = userEvent.setup()
  const { client } = mountInventoryDrawer(steppedInventorySnapshot())
  client.answer
    .mockRejectedValueOnce(new IntakeRequestError(422, 'invalid_answer', 'note'))
    .mockRejectedValueOnce(new Error('lost acknowledgement'))
  const drawer = await screen.findByRole('dialog', { name: 'Inventory · Packet A' })
  const form = await within(drawer).findByRole('form', {
    name: 'Session question: Packet A and stock #1712',
  })
  expect(within(form).getByText('Step 1 of 2')).toBeVisible()
  // The options are live cards: picking one chooses it, sending waits for Send.
  await user.click(within(form).getByRole('radio', { name: /Different tube: add new stock/ }))
  expect(client.answer).not.toHaveBeenCalled()
  await user.click(within(form).getByRole('button', { name: 'Next' }))
  await user.type(within(form).getByLabelText('Your answer'), 'Bent leads')
  await user.click(within(form).getByRole('button', { name: 'Next' }))
  await user.click(within(form).getByRole('button', { name: 'Send 2 answers' }))

  // Confirmed through perform(): the named step shows why and stays editable.
  expect(await within(form).findByText('Step 2 of 2')).toBeVisible()
  expect(within(form).getByText(/This answer wasn’t accepted/)).toBeVisible()
  expect(within(drawer).queryByText(/Command not confirmed/)).toBeNull()
  const box = within(form).getByLabelText('Your answer')
  expect(box).toBeEnabled()
  await user.clear(box)
  await user.type(box, 'Leads are fine')
  await user.click(within(form).getByRole('button', { name: 'Next' }))
  await user.click(within(form).getByRole('button', { name: 'Send 2 answers' }))

  // An uncertain failure keeps the exact payload and key for the retry.
  const retry = await within(form).findByRole('button', { name: 'Retry exact answer' })
  const answered = steppedInventorySnapshot()
  answered.jobs[0].questions[0].state = 'answered'
  client.read.mockResolvedValue(answered)
  await user.click(retry)
  // Once saved, the question leaves the drawer and focus goes to its heading.
  await waitFor(() => expect(screen.queryByRole('form', { name: /^Session question/ })).toBeNull())
  await waitFor(() =>
    expect(
      within(screen.getByRole('dialog')).getByRole('heading', { name: 'Inventory · Packet A' }),
    ).toHaveFocus(),
  )
  const calls = client.answer.mock.calls
  expect(calls).toHaveLength(3)
  expect(calls[1][2]).toEqual(
    expect.objectContaining({
      schema_version: 'bench-intake-answer/2',
      steps: [
        { step_id: 'same_tube', value: { kind: 'choice', option_id: 'new' } },
        { step_id: 'note', value: { kind: 'text', text: 'Leads are fine' } },
      ],
    }),
  )
  expect(calls[2]).toEqual(calls[1])
  expect(calls[1][3]).not.toBe(calls[0][3])
})

test('a refused stepped answer whose refresh then fails says it wasn’t accepted, not unconfirmed', async () => {
  const user = userEvent.setup()
  const { client } = mountInventoryDrawer(steppedInventorySnapshot())
  const drawer = await screen.findByRole('dialog', { name: 'Inventory · Packet A' })
  const form = await within(drawer).findByRole('form', {
    name: 'Session question: Packet A and stock #1712',
  })
  await user.click(within(form).getByRole('radio', { name: /Same tube as stock #1712/ }))
  await user.click(within(form).getByRole('button', { name: 'Next' }))
  await user.type(within(form).getByLabelText('Your answer'), 'Bent leads')
  await user.click(within(form).getByRole('button', { name: 'Next' }))
  client.answer.mockRejectedValueOnce(new IntakeRequestError(422, 'invalid_answer', 'note'))
  client.read.mockRejectedValue(new Error('read failed'))
  await user.click(within(form).getByRole('button', { name: 'Send 2 answers' }))
  expect(
    await screen.findByText(/The answer wasn’t accepted, and current status is unavailable/),
  ).toBeInTheDocument()
  expect(screen.queryByText(/original delivery identity are kept/)).toBeNull()
  expect(within(form).getByLabelText('Your answer')).toHaveValue('Bent leads')
})

test('a stepped answer sent from the drawer leaves Needs you and shows in the chat beside a /1 answer', async () => {
  const user = userEvent.setup()
  const answered = steppedInventorySnapshot()
  answered.jobs[0].questions[0].state = 'answered'
  const client = {
    ...clientFixture(),
    read: vi.fn().mockResolvedValue(steppedInventorySnapshot()),
    session: vi.fn().mockResolvedValue({
      job_id: jobId,
      attempt_id: attemptId,
      session_state: 'waiting_input',
      outbox: [],
      inbox: [],
    }),
    chat: vi.fn(),
    answer: vi.fn().mockImplementation(() => {
      client.read.mockResolvedValue(answered)
      // The next session read holds an earlier /1 answer and this /2 one.
      client.session.mockResolvedValue({
        job_id: jobId,
        attempt_id: attemptId,
        session_state: 'queued',
        outbox: [],
        inbox: [
          {
            id: 'a1',
            seq: '1',
            kind: 'answer',
            created_at: '2026-11-23T09:00:00.000Z',
            payload: {
              question_id: 'c0000000-0000-4000-8000-0000000000e1',
              answer_id: 'c0000000-0000-4000-8000-0000000000e2',
              value: { kind: 'quantity', value: '12', basis: 'counted' },
            },
          },
          {
            id: 'a2',
            seq: '2',
            kind: 'answer',
            created_at: '2026-11-23T09:05:00.000Z',
            payload: {
              question_id: questionId,
              answer_id: 'c0000000-0000-4000-8000-0000000000e3',
              steps: [
                {
                  step_id: 'same_tube',
                  value: { kind: 'choice', option_id: 'same', label: 'Same tube as stock #1712' },
                },
                { step_id: 'note', value: { kind: 'text', text: 'Bent leads' } },
              ],
            },
          },
        ],
      })
      return Promise.resolve()
    }),
  } satisfies ProcessingClient
  const { queryClient } = mountView(client, 'overview', jobId)
  // Needs you is on the page behind the open drawer, so hidden from the accessibility tree.
  const needsYou = await screen.findByRole('region', { name: 'Needs you', hidden: true })
  expect(
    within(needsYou).getByRole('link', { name: 'Answer: Packet A and stock #1712', hidden: true }),
  ).toBeInTheDocument()
  const drawer = await screen.findByRole('dialog')
  const form = await within(drawer).findByRole('form', {
    name: 'Session question: Packet A and stock #1712',
  })
  await user.click(within(form).getByRole('radio', { name: /Same tube as stock #1712/ }))
  await user.click(within(form).getByRole('button', { name: 'Next' }))
  await user.type(within(form).getByLabelText('Your answer'), 'Bent leads')
  await user.click(within(form).getByRole('button', { name: 'Next' }))
  await user.click(within(form).getByRole('button', { name: 'Send 2 answers' }))
  await waitFor(() =>
    expect(
      within(screen.getByRole('region', { name: 'Needs you', hidden: true })).queryByRole('link', {
        name: 'Answer: Packet A and stock #1712',
        hidden: true,
      }),
    ).toBeNull(),
  )
  // The saved answer's batch event invalidates the scoped reads, the session's included.
  await act(() => queryClient.invalidateQueries())
  const log = await within(screen.getByRole('dialog')).findByRole('log', {
    name: 'Session messages',
  })
  await waitFor(() =>
    expect(log).toHaveTextContent('Answered: Same tube as stock #1712 · Bent leads'),
  )
  expect(log).toHaveTextContent('Answered: 12')
  expect(client.answer).toHaveBeenCalledTimes(1)
})

test('the Research page explains research lanes behind a help button beside its heading', async () => {
  const user = userEvent.setup()
  render(
    <ServerStateProvider scope={scope} client={createServerQueryClient()}>
      <ProcessingWorkspace
        batch={batch}
        client={clientFixture()}
        view="research"
        navigate={vi.fn()}
        onDirtyChange={vi.fn()}
        onSaved={vi.fn().mockResolvedValue(undefined)}
      />
    </ServerStateProvider>,
  )
  const heading = await screen.findByRole('heading', { name: 'Research', level: 2 })

  expect(screen.queryByText(/research lane per account/)).not.toBeInTheDocument()
  await user.click(within(heading.parentElement!).getByRole('button', { name: 'About Research' }))
  const help = await screen.findByRole('dialog', { name: 'About Research' })
  expect(help).toHaveTextContent(/one lot at a time/)
})

test('a first visit shows the Processing skeleton, not a reading line', async () => {
  const client = clientFixture()
  const fresh = deferredRead()
  client.read.mockReturnValueOnce(fresh.promise)
  mount(client)

  expect(screen.getByRole('status', { name: '' })).toHaveTextContent('Loading')
  expect(screen.queryByText(/Reading retained processing state/)).not.toBeInTheDocument()
  await act(async () => {
    fresh.resolve(snapshot)
    await fresh.promise
  })
  expect((await screen.findAllByText(/How many are in Packet A\?/)).length).toBeGreaterThan(0)
  expect(screen.queryByText('Loading')).not.toBeInTheDocument()
})

test('a return visit shows the cached page with no banner; commands say “Updating…” until the read lands', async () => {
  const user = userEvent.setup()
  const client = clientFixture()
  const cache = createServerQueryClient()
  cache.setQueryData(serverQueryKey(scope, 'processing', batchId), snapshot)
  const fresh = deferredRead()
  client.read.mockReturnValueOnce(fresh.promise)
  mount(client, cache)

  await user.click(screen.getByRole('checkbox', { name: 'Packet A' }))
  const queue = screen.getByRole('button', { name: 'Queue new processing attempts' })
  expect(screen.queryByText(/Verifying/)).not.toBeInTheDocument()
  expect(screen.queryByRole('status', { name: /Verifying/ })).not.toBeInTheDocument()
  expect(queue).toHaveAttribute('aria-disabled', 'true')
  expect(queue).toHaveAccessibleDescription('Updating…')
  await user.click(queue)
  expect(client.start).not.toHaveBeenCalled()

  await act(async () => {
    fresh.resolve(snapshot)
    await fresh.promise
  })
  await waitFor(() => expect(queue).not.toHaveAttribute('aria-disabled'))
  expect(queue).toBeEnabled()
})

function mountPause(client: ProcessingClient, cache: QueryClient, pause: () => Promise<undefined>) {
  return render(
    <ServerStateProvider scope={scope} client={cache}>
      <ApiClientsProvider
        value={{
          agents: {
            sessions: vi.fn(async () => ({
              sessions: [],
              paused_batch_ids: [],
              paused_truncated: true as const,
              next_before: null,
              sessions_supported: true,
            })),
            settings: vi.fn(async () => agentSettings('1', null, { session_concurrency: 1 })),
            pause: vi.fn(pause),
          },
        }}
      >
        <ProcessingWorkspace
          batch={batch}
          client={client}
          view="overview"
          navigate={vi.fn()}
          onDirtyChange={vi.fn()}
          onSaved={vi.fn().mockResolvedValue(undefined)}
        />
      </ApiClientsProvider>
    </ServerStateProvider>,
  )
}

test('Pause waits for a read started after the last live hint, and is checked again when pressed', async () => {
  const user = userEvent.setup()
  const running = {
    ...snapshot,
    jobs: [{ ...snapshot.jobs[0], session_state: 'running' as const }],
  }
  const client = { ...clientFixture(), read: vi.fn().mockResolvedValue(running) }
  const cache = createServerQueryClient()
  const pause = vi.fn(async () => undefined)
  mountPause(client, cache, pause)
  const button = await screen.findByRole('button', { name: 'Pause all' })
  await waitFor(() => expect(button).not.toHaveAttribute('aria-disabled'))
  const registry = freshReads(cache)
  const key = serverQueryKey(scope, 'processing', batchId)

  // A hint arrives: during the reconciliation delay the settled read predates it.
  act(() => registry.noteHint())
  expect(button).toHaveAttribute('aria-disabled', 'true')
  expect(button).toHaveAccessibleDescription('Updating…')
  await user.click(button)
  expect(pause).not.toHaveBeenCalled()

  // Reconciliation queued behind a read that started before the hint: that read is not enough.
  const before = deferredRead()
  client.read.mockReturnValueOnce(before.promise)
  act(() => {
    void cache.refetchQueries({ queryKey: key })
  })
  act(() => registry.noteHint())
  await act(async () => {
    before.resolve(running)
    await before.promise
  })
  expect(button).toHaveAttribute('aria-disabled', 'true')

  // The reconciliation's own read lands, and Pause is available again.
  await act(async () => {
    await cache.invalidateQueries({ queryKey: key })
  })
  await waitFor(() => expect(button).not.toHaveAttribute('aria-disabled'))

  // A hint between the last render and the press is caught when pressed.
  await act(async () => {
    registry.noteHint()
    button.click()
  })
  expect(pause).not.toHaveBeenCalled()
  // Nothing was sent, so nothing failed: the press waits quietly.
  expect(screen.queryByText(/Pausing failed/)).not.toBeInTheDocument()
  expect(button).toHaveAccessibleDescription('Updating…')
})

test('Resume waits for a read started after the last live hint, and is checked again when pressed', async () => {
  const user = userEvent.setup()
  const paused = {
    ...snapshot,
    jobs: [{ ...snapshot.jobs[0], session_state: 'running' as const }],
    paused: true as const,
  }
  const client = { ...clientFixture(), read: vi.fn().mockResolvedValue(paused) }
  const cache = createServerQueryClient()
  const pause = vi.fn(async () => undefined)
  mountPause(client, cache, pause)
  const button = await screen.findByRole('button', { name: 'Resume' })
  await waitFor(() => expect(button).not.toHaveAttribute('aria-disabled'))

  act(() => freshReads(cache).noteHint())
  expect(button).toHaveAccessibleDescription('Updating…')
  await user.click(button)
  expect(pause).not.toHaveBeenCalled()

  await act(async () => {
    await cache.invalidateQueries({ queryKey: serverQueryKey(scope, 'processing', batchId) })
  })
  await waitFor(() => expect(button).not.toHaveAttribute('aria-disabled'))
  await user.click(button)
  await waitFor(() => expect(pause).toHaveBeenCalledWith(batchId, false))
})

test('the overview bar stops moving while a read from before the last live hint is shown', async () => {
  const working = {
    ...snapshot,
    jobs: [{ ...snapshot.jobs[0], state: 'running' as const, session_state: 'running' as const }],
  }
  const client = { ...clientFixture(), read: vi.fn().mockResolvedValue(working) }
  const cache = createServerQueryClient()
  const { container } = mountPause(client, cache, async () => undefined)

  const animated = () => container.querySelectorAll('[data-animated="true"]')

  await waitFor(() => expect(animated()).toHaveLength(1))

  act(() => freshReads(cache).noteHint())
  expect(animated()).toHaveLength(0)

  await act(async () => {
    await cache.invalidateQueries({ queryKey: serverQueryKey(scope, 'processing', batchId) })
  })
  await waitFor(() => expect(animated()).toHaveLength(1))
})

/** The fixture batch with a finished Research job for Packet A. */
function researchClient(
  state: ProcessingSnapshotDto['jobs'][number]['state'],
  proposals: ProcessingSnapshotDto['jobs'][number]['proposals'] = [],
) {
  const researched: ProcessingSnapshotDto = {
    ...snapshot,
    jobs: [
      ...snapshot.jobs,
      {
        ...snapshot.jobs[0],
        id: 'e0000000-0000-4000-8000-00000000000e',
        stage: 'research',
        state,
        proposals,
        questions: [],
      },
    ],
  }
  return { ...clientFixture(), read: vi.fn().mockResolvedValue(researched) }
}

/** jsdom has no scrolling; the stub records which element was brought into view. */
function stubScroll() {
  const scroll = vi.fn()
  Element.prototype.scrollIntoView = scroll
  onTestFinished(() => {
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
  })
  return scroll
}

function mountFocused(client: ProcessingClient, view: 'overview' | 'research' | 'images') {
  const cache = createServerQueryClient()

  const element = (shown: typeof view, focus: string | null) => (
    <ServerStateProvider scope={scope} client={cache}>
      <ProcessingWorkspace
        batch={batch}
        client={client}
        view={shown}
        focusLotId={focus}
        navigate={vi.fn()}
        onDirtyChange={vi.fn()}
        onSaved={vi.fn().mockResolvedValue(undefined)}
      />
    </ServerStateProvider>
  )

  const mounted = render(element(view, subjectId))
  return (shown: typeof view, focus: string | null) => mounted.rerender(element(shown, focus))
}

test('a step page loaded with a lot in its address scrolls to that lot’s output and highlights it', async () => {
  const scroll = stubScroll()
  mountFocused(researchClient('ready'), 'research')
  const outputs = await screen.findByRole('region', { name: 'Outputs' })
  const card = outputs.querySelector('[data-highlighted]')!

  expect(card).toHaveTextContent('Packet A · research')
  await waitFor(() => expect(scroll).toHaveBeenCalledOnce())
  expect(scroll.mock.contexts[0]).toBe(card)
  expect(screen.queryByText(/output for this lot yet/)).toBeNull()
})

test('a lot whose step is unfinished but has a candidate opens on that output', async () => {
  const scroll = stubScroll()
  const candidate = {
    id: 'f0000000-0000-4000-8000-00000000000f',
    message_id: 'f1000000-0000-4000-8000-00000000000f',
    value: { subject_id: subjectId, summary: 'RES-0144, 10 kΩ 0603', sources: [] },
    currentness: { state: 'provisional' },
  } as unknown as ProcessingSnapshotDto['jobs'][number]['proposals'][number]
  mountFocused(researchClient('waiting_for_user', [candidate]), 'research')
  const outputs = await screen.findByRole('region', { name: 'Outputs' })
  const card = outputs.querySelector('[data-highlighted]')!

  expect(card).toHaveTextContent('RES-0144, 10 kΩ 0603')
  await waitFor(() => expect(scroll.mock.contexts[0]).toBe(card))
  expect(screen.queryByText(/output for this lot yet/)).toBeNull()
})

test('a step page loaded with a lot that has no output there says so with the lot’s state', async () => {
  const scroll = stubScroll()
  mountFocused(researchClient('ready'), 'images')
  const focus = await screen.findByRole('region', { name: 'Packet A' })

  expect(focus).toHaveTextContent('No Images output for this lot yet')
  expect(within(focus).getByText('Not started')).toBeInTheDocument()
  await waitFor(() => expect(scroll.mock.contexts[0]).toBe(focus))
})

test('returning to the same lot from the Overview brings its output into view again', async () => {
  const scroll = stubScroll()
  const show = mountFocused(researchClient('ready'), 'research')
  await waitFor(() => expect(scroll).toHaveBeenCalledOnce())

  show('overview', null)
  await screen.findByRole('table', { name: 'Lots' })
  show('research', subjectId)
  await waitFor(() => expect(scroll).toHaveBeenCalledTimes(2))
})

test('the Research page counts its own step, not every step in the batch', async () => {
  mountFocused(researchClient('ready'), 'research')
  const heading = await screen.findByRole('heading', { name: 'Research' })

  expect(heading.parentElement).toHaveTextContent('1 lot · 1 done')
  expect(screen.queryByText(/need answers|\d ready/)).toBeNull()
})
