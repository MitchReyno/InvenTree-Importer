import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { onlineManager } from '@tanstack/react-query'
import { validate, type CaptureSnapshotDto, type ProcessingSnapshotDto } from '@invimport/contracts'
import { ProcessingWorkspace } from './components/processing/ProcessingWorkspace'
import { ServerStateProvider } from './components/query/ServerStateProvider'
import { createServerQueryClient } from './queries/client'
import { serverQueryKey, type ServerScope } from './queries/scope'
import type { ProcessingClient } from './processing/types'

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
          spec: {
            kind: 'quantity',
            subject_id: subjectId,
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

afterEach(() => {
  onlineManager.setOnline(true)
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
  expect(queue).toBeDisabled()
  expect(cancel).toBeDisabled()
  expect(
    screen.queryByRole('button', { name: 'Save answer and queue continuation' }),
  ).not.toBeInTheDocument()

  act(() => {
    cache.setQueryData(key, { ...snapshot, cursor: { ...snapshot.cursor, sequence: '99' } })
  })
  expect(queue).toBeDisabled()
  expect(screen.queryByLabelText('Quantity')).not.toBeInTheDocument()
  expect(client.start).not.toHaveBeenCalled()
  await act(async () => {
    fresh.resolve(snapshot)
    await fresh.promise
  })
  await waitFor(() => expect(queue).toBeEnabled())
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
  expect(queue).toBeDisabled()
  expect(cancel).toBeDisabled()
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
    spec: { ...newer.jobs[0].questions[0].spec, prompt: 'Replacement count question' },
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
    spec: { ...current.jobs[0].questions[0].spec, prompt: 'The new current question' },
  })
  validate('ProcessingSnapshot', current)
  await act(async () => {
    fresh.resolve(current)
    await fresh.promise
  })
  const form = await screen.findByRole('form', { name: 'Pinned application question' })
  expect(within(form).getByText(/question revision 2/)).toBeInTheDocument()
  expect(within(form).queryByText(/question revision 1/)).not.toBeInTheDocument()
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
  await waitFor(() => expect(queue).toBeEnabled())
  const resumed = deferredRead()
  client.read.mockReturnValueOnce(resumed.promise)
  const key = serverQueryKey(scope, 'processing', batchId)
  act(() => {
    onlineManager.setOnline(false)
    void cache.invalidateQueries({ queryKey: key })
  })
  await waitFor(() => expect(cache.getQueryState(key)?.fetchStatus).toBe('paused'))
  expect(queue).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Cancel this attempt' })).toBeDisabled()
  act(() => {
    onlineManager.setOnline(true)
  })
  await waitFor(() => expect(client.read).toHaveBeenCalledTimes(2))
  expect(queue).toBeDisabled()
  await act(async () => {
    resumed.resolve(snapshot)
    await resumed.promise
  })
  await waitFor(() => expect(queue).toBeEnabled())
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
  const sources = screen.getByRole('list', { name: 'Retained candidate sources' })
  expect(within(sources).getByText('a0000000-0000-4000-8000-000000000008')).toBeInTheDocument()
  expect(within(sources).getByText('a0000000-0000-4000-8000-000000000007')).toBeInTheDocument()
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
  act(() => mounted.cache.setQueryData(serverQueryKey(scope, 'processing', batchId), noAction))
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Cancel this attempt' })).not.toBeInTheDocument(),
  )
  expect(client.cancel).toHaveBeenCalledTimes(1)
})

function mountView(client: ProcessingClient, view: 'overview' | 'examine') {
  render(
    <ServerStateProvider scope={scope} client={createServerQueryClient()}>
      <ProcessingWorkspace
        batch={batch}
        client={client}
        view={view}
        navigate={vi.fn()}
        onDirtyChange={vi.fn()}
        onSaved={vi.fn().mockResolvedValue(undefined)}
      />
    </ServerStateProvider>,
  )
}

test('the fixture profile shows its jobs and questions by step, and claims no live session', async () => {
  mountView(clientFixture(), 'overview')
  const steps = await screen.findByRole('list', { name: 'Steps' })

  expect(within(steps).getByText('1 waiting · 1 question')).toBeInTheDocument()
  expect(
    within(screen.getByRole('region', { name: 'Needs you' })).getByRole('link', {
      name: 'How many are in Packet A?',
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

  await waitFor(() => expect(session).toHaveBeenCalledWith(batchId, jobId))
  expect(
    within(drawer).getByRole('link', { name: 'How many are in Packet A?' }),
  ).toBeInTheDocument()
  await userEvent.click(within(drawer).getByRole('button', { name: 'Close' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
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

  expect(await screen.findByText('No retained work on Research yet.')).toBeInTheDocument()
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
