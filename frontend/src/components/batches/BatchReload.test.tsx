import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { CaptureSnapshotDto, ProcessingSnapshotDto } from '@invimport/contracts'
import type { Client } from '#/capture/client'
import type { ManualClient } from '#/manual/types'
import type { ProcessingClient } from '#/processing/types'
import { createServerQueryClient } from '#/queries/client'
import { cancelVerified } from '#/queries/fresh-reads'
import { serverQueryKey } from '#/queries/scope'
import { deferred } from '#/test/deferred'
import { fixtureScope, render } from '#/test/render'
import { Batch } from './Batch'

const batchId = '10000000-0000-4000-8000-000000000001'
const lotId = '20000000-0000-4000-8000-000000000002'
const jobId = '30000000-0000-4000-8000-000000000003'
const attemptId = '40000000-0000-4000-8000-000000000004'
const questionId = '50000000-0000-4000-8000-000000000005'
const cursor = { stream_id: 'b0000000-0000-4000-8000-000000000002', sequence: '8' }
const saved: CaptureSnapshotDto = {
  id: batchId,
  source_id: '90000000-0000-4000-8000-000000000009',
  title: 'Packet questions',
  revision: '8',
  archived: false,
  updated_at: '2026-11-02T00:00:00Z',
  actor_id: fixtureScope.actorId,
  target_context_id: fixtureScope.targetContextId,
  defaults: { quantity: { mode: 'unknown' }, location: { mode: 'clear' } },
  parts: [],
  notes: [],
  observations: [],
  lots: [
    {
      id: lotId,
      label: 'Packet A',
      revision: '3',
      contribution_key: 'a0000000-0000-4000-8000-000000000001',
      part_subject_id: null,
      quantity: { mode: 'inherit' },
      location: { mode: 'inherit' },
    },
  ],
  cursor,
}
const answered: CaptureSnapshotDto = {
  ...saved,
  title: 'Packet questions, answered',
  revision: '9',
  lots: [{ ...saved.lots[0], revision: '4', quantity: { mode: 'set', value: '37' } }],
}

function question(id: string, prompt: string) {
  return {
    id,
    job_id: jobId,
    attempt_id: attemptId,
    input_sha256: 'a'.repeat(64),
    revision: '1',
    state: 'open' as const,
    subject_id: lotId,
    spec: { kind: 'quantity' as const, prompt, reason: 'The label is unclear.' },
  }
}

const secondQuestionId = '50000000-0000-4000-8000-000000000006'
const processing: ProcessingSnapshotDto = {
  batch_id: batchId,
  capture_revision: '8',
  runner_status: 'fixture_only',
  cursor,
  jobs: [
    {
      id: jobId,
      subject_id: lotId,
      stage: 'examine',
      revision: '2',
      state: 'waiting_for_user',
      attempt_id: attemptId,
      input_sha256: 'a'.repeat(64),
      attempt_number: '1',
      qualification: 'fixture_only',
      proposals: [],
      questions: [
        question(questionId, 'How many are in Packet A?'),
        question(secondQuestionId, 'How many spares came with Packet A?'),
      ],
    },
  ],
}

let cache: QueryClient

function processingClient() {
  return {
    read: vi.fn(async () => processing),
    start: vi.fn(),
    cancel: vi.fn(),
    answer: vi.fn(async () => ({
      answer_id: 'c0000000-0000-4000-8000-000000000003',
      question_id: questionId,
      attempt_id: attemptId,
      capture_revision: '9',
      command_id: 'd0000000-0000-4000-8000-000000000004',
    })),
  } satisfies ProcessingClient
}

function mount(read: Client['read'], route = `${batchId}/processing/examine/${questionId}`) {
  const client = { read: vi.fn(read) } as unknown as Client
  const processingRead = processingClient()

  const ui = (at: string) => (
    <Batch
      id={batchId}
      client={client}
      manual={{} as ManualClient}
      route={at}
      onDirtyChange={vi.fn()}
    />
  )

  const view = render(ui(route), { cache, clients: { processing: processingRead } })
  return {
    client,
    processing: processingRead,
    show: (at: string) => view.rerender(ui(at)),
  }
}

/** What `LiveUpdates` does for a hint: cancel through the registry, then invalidate the scope. */
async function reconcile() {
  await act(async () => {
    await cancelVerified(cache, { queryKey: serverQueryKey(fixtureScope) }, { silent: true })
    void cache.invalidateQueries({ queryKey: serverQueryKey(fixtureScope) })
  })
}

async function answerFirstQuestion() {
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText('Quantity'), '37')
  await user.click(screen.getByRole('button', { name: 'Save answer and queue continuation' }))
}

function noReloadMessage() {
  expect(screen.queryByText(/Saved values still unavailable/)).not.toBeInTheDocument()
  expect(screen.queryByText(/Couldn’t load the latest values/)).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Discard/ })).not.toBeInTheDocument()
}

beforeEach(() => {
  sessionStorage.clear()
  cache = createServerQueryClient()
})

afterEach(() => {
  vi.useRealTimers()
  sessionStorage.clear()
})

test('a reload a live update cancels and replaces shows nothing, on any tab, and shows the new values', async () => {
  const reload = deferred<CaptureSnapshotDto>()
  const replacement = deferred<CaptureSnapshotDto>()
  const reads = [async () => saved, () => reload.promise, () => replacement.promise]
  const { client, show } = mount(() => (reads.shift() ?? (async () => answered))())
  expect(await screen.findByRole('heading', { name: 'Packet questions' })).toBeInTheDocument()

  await answerFirstQuestion()
  // The reload after the answer is in flight when the answer's live update arrives.
  await waitFor(() => expect(client.read).toHaveBeenCalledTimes(2))
  await reconcile()
  await waitFor(() => expect(client.read).toHaveBeenCalledTimes(3))
  await act(async () => {
    reload.resolve(saved)
    replacement.resolve(answered)
  })
  await waitFor(() =>
    expect(cache.getQueryData(serverQueryKey(fixtureScope, 'capture', batchId))).toEqual(answered),
  )

  noReloadMessage()
  expect(screen.queryByText(/current status is unavailable/)).not.toBeInTheDocument()
  expect(screen.queryByText(/Current capture is unavailable/)).not.toBeInTheDocument()
  expect(
    await screen.findByRole('heading', { name: 'Packet questions, answered' }),
  ).toBeInTheDocument()
  // The batch's notice would follow the operator to every tab; there is none.
  show(batchId)
  noReloadMessage()
  show(`${batchId}/review/map`)
  noReloadMessage()
})

test('a replaced reload whose replacement fails reports the saved values unavailable, calmly', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 25, 13, 12))
  const reload = deferred<CaptureSnapshotDto>()
  const replacement = deferred<CaptureSnapshotDto>()
  const reads = [async () => saved, () => reload.promise, () => replacement.promise]
  const { client } = mount(() => (reads.shift() ?? (async () => answered))())
  expect(await screen.findByRole('heading', { name: 'Packet questions' })).toBeInTheDocument()

  await answerFirstQuestion()
  await waitFor(() => expect(client.read).toHaveBeenCalledTimes(2))
  vi.setSystemTime(new Date(2026, 10, 25, 13, 20))
  await reconcile()
  await waitFor(() => expect(client.read).toHaveBeenCalledTimes(3))
  await act(async () => replacement.reject(new Error('server_unreachable')))

  const clock = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
  const notice = await screen.findByRole('status', { name: '' })
  await waitFor(() =>
    expect(
      screen.getByText(/Couldn’t load the latest values/).closest('[role="status"]'),
    ).toHaveTextContent(
      `Couldn’t load the latest values. Showing what was loaded at ${clock.format(
        new Date(2026, 10, 25, 13, 12),
      )}. Trying again…`,
    ),
  )
  expect(notice).toBeDefined()
  expect(screen.getByRole('button', { name: 'Try now' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Discard/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

test('the notice stays through a cache write, and clears once a network read lands', async () => {
  const user = userEvent.setup()
  const reads: (() => Promise<CaptureSnapshotDto>)[] = [
    async () => saved,
    async () => {
      throw new Error('server_unreachable')
    },
  ]
  const { client } = mount(() => (reads.shift() ?? (async () => answered))())
  expect(await screen.findByRole('heading', { name: 'Packet questions' })).toBeInTheDocument()

  await answerFirstQuestion()
  expect(await screen.findByText(/Couldn’t load the latest values/)).toBeInTheDocument()
  // An acknowledgement written into the cache is not a read of the server.
  await act(async () => {
    cache.setQueryData(serverQueryKey(fixtureScope, 'capture', batchId), answered)
  })
  expect(screen.getByText(/Couldn’t load the latest values/)).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Try now' }))
  await waitFor(() =>
    expect(screen.queryByText(/Couldn’t load the latest values/)).not.toBeInTheDocument(),
  )
  expect(client.read).toHaveBeenCalledTimes(3)
  // Nothing was edited, so the read is adopted.
  expect(screen.getByRole('heading', { name: 'Packet questions, answered' })).toBeInTheDocument()
})

test('a background read clears the notice too', async () => {
  const reads: (() => Promise<CaptureSnapshotDto>)[] = [
    async () => saved,
    async () => {
      throw new Error('server_unreachable')
    },
  ]
  mount(() => (reads.shift() ?? (async () => answered))())
  expect(await screen.findByRole('heading', { name: 'Packet questions' })).toBeInTheDocument()

  await answerFirstQuestion()
  expect(await screen.findByText(/Couldn’t load the latest values/)).toBeInTheDocument()
  await act(async () => {
    await cache.invalidateQueries({ queryKey: serverQueryKey(fixtureScope, 'capture', batchId) })
  })
  await waitFor(() =>
    expect(screen.queryByText(/Couldn’t load the latest values/)).not.toBeInTheDocument(),
  )
})

test('the notice reads again every 5 s and clears itself once a read works', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  let failing = true
  const reads: (() => Promise<CaptureSnapshotDto>)[] = [async () => saved]
  const { client } = mount(async () => {
    const next = reads.shift()
    if (next) {
      return next()
    }
    if (failing) {
      throw new Error('server_unreachable')
    }
    return answered
  })
  expect(await screen.findByRole('heading', { name: 'Packet questions' })).toBeInTheDocument()
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  await user.type(await screen.findByLabelText('Quantity'), '37')
  await user.click(screen.getByRole('button', { name: 'Save answer and queue continuation' }))
  expect(await screen.findByText(/Couldn’t load the latest values/)).toBeInTheDocument()
  const failedReads = vi.mocked(client.read).mock.calls.length

  await act(() => vi.advanceTimersByTimeAsync(5000))
  expect(client.read).toHaveBeenCalledTimes(failedReads + 1)
  expect(screen.getByText(/Couldn’t load the latest values/)).toBeInTheDocument()

  failing = false
  await act(() => vi.advanceTimersByTimeAsync(5000))
  await waitFor(() =>
    expect(screen.queryByText(/Couldn’t load the latest values/)).not.toBeInTheDocument(),
  )
  expect(screen.getByRole('heading', { name: 'Packet questions, answered' })).toBeInTheDocument()
  // No more reads once it works.
  const settledReads = vi.mocked(client.read).mock.calls.length
  await act(() => vi.advanceTimersByTimeAsync(15000))
  expect(client.read).toHaveBeenCalledTimes(settledReads)
})

test('an automatic retry that works while a draft is unsaved clears the notice and keeps the draft and its revision', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  let failing = true
  const reads: (() => Promise<CaptureSnapshotDto>)[] = [async () => saved]
  const { show } = mount(async () => {
    const next = reads.shift()
    if (next) {
      return next()
    }
    if (failing) {
      throw new Error('server_unreachable')
    }
    return answered
  })
  expect(await screen.findByRole('heading', { name: 'Packet questions' })).toBeInTheDocument()
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  await user.type(await screen.findByLabelText('Quantity'), '37')
  await user.click(screen.getByRole('button', { name: 'Save answer and queue continuation' }))
  expect(await screen.findByText(/Couldn’t load the latest values/)).toBeInTheDocument()

  // An answer draft for the other question: unsaved work its form doesn't name.
  show(`${batchId}/processing/examine/${secondQuestionId}`)
  const draft = await screen.findByLabelText('Quantity')
  await user.type(draft, '4')
  await waitFor(() =>
    expect(
      screen.getByText(/Couldn’t load the latest values/).closest('[role="status"]'),
    ).toHaveTextContent('Couldn’t load the latest values. Your unsaved changes are kept.'),
  )
  expect(screen.queryByRole('button', { name: 'Discard my changes' })).not.toBeInTheDocument()

  failing = false
  await act(() => vi.advanceTimersByTimeAsync(5000))
  await waitFor(() =>
    expect(screen.queryByText(/Couldn’t load the latest values/)).not.toBeInTheDocument(),
  )
  // Read but not adopted: the draft stays at the revision it was made on.
  expect(screen.getByLabelText('Quantity')).toHaveValue('4')
  expect(screen.getByRole('heading', { name: 'Packet questions' })).toBeInTheDocument()
  expect(cache.getQueryData(serverQueryKey(fixtureScope, 'capture', batchId))).toEqual(answered)
})
