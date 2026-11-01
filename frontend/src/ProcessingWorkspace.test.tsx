import { act, render, screen, waitFor, within } from '@testing-library/react'
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

function mount(client: ProcessingClient, cache = createServerQueryClient()) {
  const dirty = vi.fn()
  const navigate = vi.fn()
  render(
    <ServerStateProvider scope={scope} client={cache}>
      <ProcessingWorkspace
        batch={batch}
        client={client}
        view="overview"
        questionId={questionId}
        navigate={navigate}
        onDirtyChange={dirty}
        onSaved={vi.fn().mockResolvedValue(undefined)}
      />
    </ServerStateProvider>,
  )
  return { cache, dirty, navigate }
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
