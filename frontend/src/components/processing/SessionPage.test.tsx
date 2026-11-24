import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { onlineManager } from '@tanstack/react-query'
import { IntakeRequestError } from '@invimport/contracts/client'
import {
  validate,
  type CaptureSnapshotDto,
  type ProcessingSnapshotDto,
  type SessionHistoryDto,
} from '@invimport/contracts'
import { ServerStateProvider } from '#/components/query/ServerStateProvider'
import { createServerQueryClient } from '#/queries/client'
import { serverQueryKey, type ServerScope } from '#/queries/scope'
import type { ProcessingClient } from '#/processing/types'
import { setDebugMode } from '#/test/debug-mode'
import { deferred } from '#/test/deferred'
import {
  H,
  at,
  attemptHeader,
  chat,
  history,
  input,
  observation,
  photoView,
  proposal,
  question,
  reply,
  status,
} from '#/test/session-history'
import { ProcessingWorkspace } from './ProcessingWorkspace'

const scope: ServerScope = {
  origin: 'http://127.0.0.1:4310',
  actorId: 'd0000000-0000-4000-8000-00000000000d',
  targetId: 'e0000000-0000-4000-8000-00000000000e',
  targetContextId: 'f0000000-0000-4000-8000-00000000000f',
}
const batch: CaptureSnapshotDto = {
  id: H.batch,
  source_id: 'f1000000-0000-4000-8000-00000000000f',
  title: 'Spill',
  revision: '8',
  archived: false,
  updated_at: '2026-11-24T00:00:00Z',
  actor_id: scope.actorId,
  target_context_id: scope.targetContextId,
  defaults: { quantity: { mode: 'unknown' }, location: { mode: 'clear' } },
  parts: [],
  notes: [],
  observations: [],
  lots: [
    {
      id: H.lot,
      label: 'ATmega328P',
      revision: '3',
      contribution_key: 'f2000000-0000-4000-8000-00000000000f',
      part_subject_id: null,
      quantity: { mode: 'inherit' },
      location: { mode: 'inherit' },
    },
  ],
  cursor: { stream_id: 'f3000000-0000-4000-8000-00000000000f', sequence: '8' },
}
const asked = question(4, 4)
const askedQuestion = asked.details.kind === 'question' ? asked.details.question : undefined
const snapshot: ProcessingSnapshotDto = {
  batch_id: H.batch,
  capture_revision: '8',
  runner_status: 'native_unverified',
  cursor: batch.cursor,
  jobs: [
    {
      id: H.job,
      subject_id: H.lot,
      stage: 'research',
      revision: '2',
      state: 'running',
      session_state: 'running',
      attempt_id: H.attempt,
      input_sha256: 'a'.repeat(64),
      attempt_number: '1',
      qualification: 'native_unverified',
      proposals: [],
      questions: [
        {
          id: H.question,
          job_id: H.job,
          attempt_id: H.attempt,
          input_sha256: 'a'.repeat(64),
          revision: '1',
          state: 'open',
          ...askedQuestion!,
        } as ProcessingSnapshotDto['jobs'][number]['questions'][number],
      ],
    },
  ],
}
validate('CaptureSnapshot', batch)
validate('ProcessingSnapshot', snapshot)

afterEach(() => {
  setDebugMode(false)
  onlineManager.setOnline(true)
})

function client(pages: SessionHistoryDto | ((before?: string) => Promise<SessionHistoryDto>)) {
  const read = typeof pages === 'function' ? pages : () => Promise.resolve(pages)
  const history = vi.fn((_batchId: string, _jobId: string, before?: string) => read(before))
  return {
    read: vi.fn().mockResolvedValue(snapshot),
    start: vi.fn(),
    cancel: vi.fn(),
    answer: vi.fn().mockResolvedValue({
      answer_id: 'f4000000-0000-4000-8000-00000000000f',
      question_id: H.question,
      attempt_id: H.attempt,
      capture_revision: '9',
      command_id: 'f5000000-0000-4000-8000-00000000000f',
    }),
    history,
    chat: vi.fn().mockResolvedValue({ item_id: H.inboxItem, seq: '9' }),
    replaceSession: vi.fn(),
  } satisfies ProcessingClient
}

function mount(processing: ProcessingClient, cache = createServerQueryClient()) {
  const onSaved = vi.fn().mockResolvedValue(undefined)
  render(
    <ServerStateProvider scope={scope} client={cache}>
      <ProcessingWorkspace
        batch={batch}
        client={processing}
        view="research"
        sessionPageJobId={H.job}
        navigate={vi.fn()}
        onDirtyChange={vi.fn()}
        onSaved={onSaved}
      />
    </ServerStateProvider>,
  )

  const invalidate = () =>
    act(() => cache.invalidateQueries({ queryKey: serverQueryKey(scope, 'processing', H.batch) }))

  return { cache, onSaved, invalidate }
}

const conversationOf = () => screen.getByRole('list', { name: 'Session conversation' })

test('one conversation in time order, with a divider for each attempt', async () => {
  const first = attemptHeader({
    state: 'failed',
    session_state: 'failed',
    ended: { at: at(9), source: 'transition' },
  })
  const second = attemptHeader({
    id: H.attempt2,
    number: 2,
    queued_at: at(10),
    started_because: null,
  })
  mount(
    client(
      history(
        [
          status(1, 11, 'Comparing pin-outs', { attempt: 2, id: `outbox:${H.attempt2}:1` }),
          input(
            3,
            8,
            { kind: 'revision', fields: ['identity'], reason: 'Top marking reads ATMEGA328PB' },
            { who: 'app', summary: 'Revision: Top marking reads ATMEGA328PB' },
          ),
          reply(5, 7, 'Will do.'),
          chat(2, 6, 'Check the top marking again?'),
          asked,
          ...proposal(1, 3).slice(1),
        ],
        { attempts: [first, second] },
      ),
    ),
  )
  const list = await screen.findByRole('list', { name: 'Session conversation' })
  const rows = within(list).getAllByRole('listitem', { name: undefined })
  const text = rows.map((row) => row.textContent ?? '')

  const order = [
    'Attempt 1 · first attempt',
    'Read ww1.microchip.com',
    'Which ATmega328P variant is this?',
    'Check the top marking again?',
    'Will do.',
    'Top marking reads ATMEGA328PB',
    'Attempt 2',
    'Comparing pin-outs',
  ].map((part) => text.findIndex((row) => row.includes(part)))
  expect(order).toEqual([...order].sort((a, b) => a - b))
  expect(order.every((index) => index >= 0)).toBe(true)
  // Attempt 2 has no retained reason, so it reads only its number.
  expect(within(list).getByRole('separator', { name: 'Attempt 2' })).toBeInTheDocument()
  // The correction is the app's notice of the operator's correction.
  expect(text.find((row) => row.includes('ATMEGA328PB'))).toMatch(/App/)
  // Chat shows as bubbles: the operator's on the right, the agent's reply on the left.
  expect(
    within(list).getByText('Check the top marking again?').closest('[data-mine]'),
  ).toHaveAttribute('data-mine', 'true')
  expect(within(list).getByText('Will do.').closest('[data-mine]')).toHaveAttribute(
    'data-mine',
    'false',
  )
})

test('filter chips narrow the conversation, and Load older adds the older page above', async () => {
  const user = userEvent.setup()
  const newest = history([photoView(3, 5), chat(2, 4, 'Hello'), ...proposal(2, 3)], {
    before: 'older-1',
  })
  const older = history([
    photoView(1, 1, { evidence: H.evidence2, version: H.version2, photo: 'Packet back' }),
  ])
  const processing = client((before) => Promise.resolve(before === 'older-1' ? older : newest))
  mount(processing)
  await screen.findByRole('list', { name: 'Session conversation' })

  // A filter hides rows rather than removing them, so drafts in hidden cards survive.
  const shown = (text: string | RegExp) => within(conversationOf()).getByText(text)

  await user.click(screen.getByRole('button', { name: /^Messages,/ }))
  expect(shown('Hello')).toBeVisible()
  expect(shown(/Prepared/)).not.toBeVisible()
  await user.click(screen.getByRole('button', { name: /^Photos,/ }))
  expect(shown('Hello')).not.toBeVisible()
  expect(shown(/Prepared part of MCU close-up/)).toBeVisible()
  await user.click(screen.getByRole('button', { name: /^Web,/ }))
  expect(shown('Read ww1.microchip.com')).toBeVisible()
  expect(shown('Proposed ATmega328P-AU')).not.toBeVisible()
  // A web read leads back to the proposal that cites it, clearing the filter.
  await user.click(shown('Read ww1.microchip.com'))
  await user.click(screen.getByRole('button', { name: 'Show the proposal that cites it' }))
  expect(shown('Proposed ATmega328P-AU')).toBeVisible()
  await waitFor(() =>
    expect(document.activeElement?.textContent).toContain('Proposed ATmega328P-AU'),
  )
  await user.click(screen.getByRole('button', { name: /^All,/ }))

  await user.click(screen.getByRole('button', { name: 'Load older' }))
  await waitFor(() => expect(processing.history).toHaveBeenCalledWith(H.batch, H.job, 'older-1'))
  expect(
    await within(conversationOf()).findByText('Prepared part of Packet back for the agent'),
  ).toBeInTheDocument()
  // Nothing older remains.
  expect(screen.queryByRole('button', { name: 'Load older' })).toBeNull()
})

test('a change re-reads the newest page, keeping loaded older entries without duplicates', async () => {
  const user = userEvent.setup()
  let newest = history([status(3, 3, 'Three'), status(2, 2, 'Two')], { before: 'older-1' })
  const older = history([status(1, 1, 'One')])
  const processing = client((before) => Promise.resolve(before ? older : newest))
  const { invalidate } = mount(processing)
  await screen.findByText('Three')
  await user.click(screen.getByRole('button', { name: 'Load older' }))
  await screen.findByText('One')

  newest = history([status(4, 4, 'Four'), status(3, 3, 'Three')], { before: 'older-2' })
  await invalidate()
  await screen.findByText('Four')
  expect(screen.getAllByText('Three')).toHaveLength(1)
  // The entry the new one pushed off the newest page stays.
  expect(screen.getByText('Two')).toBeInTheDocument()
  expect(screen.getByText('One')).toBeInTheDocument()

  // More than a page arrived: the older entries go, and Load older continues from the new page.
  newest = history([status(6, 6, 'Six'), status(5, 5, 'Five')], { before: 'older-5' })
  await invalidate()
  await screen.findByText('Six')
  expect(screen.queryByText('One')).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Load older' }))
  await waitFor(() =>
    expect(processing.history).toHaveBeenLastCalledWith(H.batch, H.job, 'older-5'),
  )
})

test('a re-read refreshes a proposal’s links, shows another tab’s chat and what the session read', async () => {
  let newest = history(
    [
      chat(3, 3, 'Sent from here', { read: false }),
      ...proposal(1, 1, { currentness: { state: 'provisional', question_ids: [H.question] } }),
    ],
    { acked: '2' },
  )
  const processing = client(() => Promise.resolve(newest))
  const { invalidate } = mount(processing)
  await screen.findByText('Proposed ATmega328P-AU · provisional')
  expect(screen.getByText('Not read yet')).toBeInTheDocument()

  // A matching question answered in another job, a chat from another tab and an acknowledgement.
  newest = history([
    chat(4, 4, 'Sent from another tab'),
    chat(3, 3, 'Sent from here'),
    ...proposal(1, 1),
  ])
  await invalidate()
  await screen.findByText('Sent from another tab')
  expect(screen.getByText('Proposed ATmega328P-AU')).toBeInTheDocument()
  expect(screen.queryByText('Not read yet')).toBeNull()
})

test('the message box sends once to the session’s inbox, and the message shows as yours', async () => {
  const user = userEvent.setup()
  let newest = history([status(1, 1, 'Working')])
  const processing = client(() => Promise.resolve(newest))
  processing.chat.mockImplementation(async () => {
    newest = history([
      chat(1, 2, 'Check the Microchip PB datasheet first'),
      status(1, 1, 'Working'),
    ])
    return { item_id: H.inboxItem, seq: '1' }
  })
  mount(processing)
  const box = await screen.findByRole('textbox', { name: 'Message Research' })
  await user.type(box, 'Check the Microchip PB datasheet first')
  await user.click(screen.getByRole('button', { name: 'Send' }))
  await user.click(screen.getByRole('button', { name: 'Send' }))

  await waitFor(() => expect(processing.chat).toHaveBeenCalledTimes(1))
  expect(processing.chat.mock.calls[0].slice(0, 3)).toEqual([
    H.batch,
    H.job,
    expect.objectContaining({ text: 'Check the Microchip PB datasheet first' }),
  ])
  const bubble = await within(conversationOf()).findByText('Check the Microchip PB datasheet first')
  expect(bubble.closest('[data-mine]')).toHaveAttribute('data-mine', 'true')
})

test('an open question is answered in place through the session question path', async () => {
  const user = userEvent.setup()
  const processing = client(history([asked]))
  const { onSaved } = mount(processing)
  const card = await screen.findByRole('form', {
    name: 'Session question: Which ATmega328P variant is this?',
  })
  await user.click(await within(card).findByRole('radio', { name: /ATmega328PB-AU/ }))
  const send = within(card).getByRole('button', { name: /Send/ })
  await waitFor(() => expect(send).toBeEnabled())
  await user.click(send)

  await waitFor(() => expect(processing.answer).toHaveBeenCalledTimes(1))
  expect(processing.answer.mock.calls[0].slice(0, 2)).toEqual([H.batch, H.question])
  expect(processing.answer.mock.calls[0][2]).toMatchObject({
    expected_capture_revision: '8',
    attempt_id: H.attempt,
  })
  await waitFor(() => expect(onSaved).toHaveBeenCalled())
})

test('answering waits for the page’s own Processing read, and stops while it fails or pauses', async () => {
  const user = userEvent.setup()
  const cache = createServerQueryClient()
  cache.setDefaultOptions({
    queries: { ...cache.getDefaultOptions().queries, networkMode: 'online' },
  })
  // A warm cache from an earlier visit verifies nothing until this mount's read lands.
  cache.setQueryData(serverQueryKey(scope, 'processing', H.batch), snapshot)
  const processing = client(history([asked]))
  const pending = deferred<ProcessingSnapshotDto>()
  processing.read.mockReturnValueOnce(pending.promise)
  const { invalidate } = mount(processing, cache)
  // Until this mount's own read lands, the question offers only its link, never a form.
  await screen.findByText('Asked: Which ATmega328P variant is this?')
  expect(screen.queryByRole('form', { name: /Session question/ })).toBeNull()
  await act(async () => {
    pending.resolve(snapshot)
    await pending.promise
  })
  const card = await screen.findByRole('form', {
    name: 'Session question: Which ATmega328P variant is this?',
  })
  await user.click(within(card).getByRole('radio', { name: /ATmega328PB-AU/ }))

  const send = () => within(card).getByRole('button', { name: /Send/ })

  const unavailable = () =>
    send().hasAttribute('disabled') || send().getAttribute('aria-disabled') === 'true'

  await waitFor(() => expect(unavailable()).toBe(false))

  processing.read.mockRejectedValueOnce(new Error('offline'))
  await invalidate()
  await waitFor(() => expect(unavailable()).toBe(true))

  processing.read.mockResolvedValue(snapshot)
  await invalidate()
  await waitFor(() => expect(unavailable()).toBe(false))
  act(() => {
    onlineManager.setOnline(false)
    void cache.invalidateQueries({ queryKey: serverQueryKey(scope, 'processing', H.batch) })
  })
  await waitFor(() =>
    expect(cache.getQueryState(serverQueryKey(scope, 'processing', H.batch))?.fetchStatus).toBe(
      'paused',
    ),
  )
  expect(unavailable()).toBe(true)
  expect(processing.answer).not.toHaveBeenCalled()
})

test('a session outside the batch or the caller’s scope is not found and shows no history', async () => {
  mount(
    client(() =>
      Promise.reject(new IntakeRequestError(404, 'session_not_found', 'Session not found')),
    ),
  )

  expect(await screen.findByText('This session was not found.')).toBeInTheDocument()
  expect(screen.queryByRole('list', { name: 'Session conversation' })).toBeNull()
})

test('the header names the session, and debug details show only in debug mode', async () => {
  const processing = client(history([status(1, 1, 'Working')]))
  mount(processing)
  const header = await screen.findByRole('region', { name: 'Research · ATmega328P' })

  expect(header).toHaveTextContent('claude-opus-5-5')
  expect(header).toHaveTextContent('agent VM')
  expect(header).toHaveTextContent('web pages allowed')
  expect(header).toHaveTextContent('1 attempt')
  expect(screen.queryByText(H.job)).toBeNull()

  setDebugMode(true)
  expect(await screen.findByText(new RegExp(H.job))).toBeInTheDocument()
})

test('the photos and sources panels say older entries are not loaded, then list them', async () => {
  const user = userEvent.setup()
  const newest = history([status(2, 2, 'Working')], { before: 'older-1' })
  const older = history([photoView(1, 1), ...proposal(1, 1)])
  mount(client((before) => Promise.resolve(before ? older : newest)))
  const photos = await screen.findByRole('region', { name: 'Photos it viewed' })
  const sources = screen.getByRole('region', { name: 'Sources it cited' })

  expect(photos).toHaveTextContent('Older entries are not loaded yet')
  expect(sources).toHaveTextContent('Older entries are not loaded yet')
  await user.click(screen.getByRole('button', { name: 'Load older' }))

  expect(await within(photos).findByText('MCU close-up')).toBeInTheDocument()
  expect(within(sources).getByRole('link', { name: /ww1\.microchip\.com/ })).toBeInTheDocument()
  expect(photos).not.toHaveTextContent('Older entries are not loaded yet')
})

test('observations from different photos stay apart on the page', async () => {
  mount(
    client(
      history([
        observation(2, 2, {
          id: H.part,
          evidence: H.evidence2,
          version: H.version2,
          photo: 'Packet back',
        }),
        observation(1, 1),
      ]),
    ),
  )

  expect(await screen.findByText('Recorded an observation in Packet back')).toBeInTheDocument()
  expect(screen.getByText('Recorded an observation in Bench bag spill')).toBeInTheDocument()
})

test('an unsaved answer on the page stays, marked answered elsewhere, when another place answers it', async () => {
  const user = userEvent.setup()
  let page = history([asked])
  const processing = client(() => Promise.resolve(page))
  const { invalidate } = mount(processing)
  const card = await screen.findByRole('form', {
    name: 'Session question: Which ATmega328P variant is this?',
  })
  await user.click(within(card).getByRole('radio', { name: /ATmega328PB-AU/ }))

  // The drawer in another tab answered it: both reads now say so.
  const answered = structuredClone(snapshot)
  answered.jobs[0].questions[0].state = 'answered'
  processing.read.mockResolvedValue(answered)
  page = history([question(4, 4, { state: 'answered' })])
  await invalidate()

  await waitFor(() => expect(card).toHaveTextContent('Answered elsewhere; your unsaved answer can’t be sent.'))
  expect(within(card).getByRole('radio', { name: /ATmega328PB-AU/ })).toBeChecked()
  expect(processing.answer).not.toHaveBeenCalled()
})

test('the history shows while the Processing read fails', async () => {
  const failing = client(history([status(1, 1, 'Reading the slip')]))
  failing.read.mockRejectedValue(new Error('offline'))
  mount(failing)
  expect(await screen.findByText('Reading the slip')).toBeInTheDocument()
  // Nothing can be answered without this mount's own Processing read.
  expect(screen.queryByRole('form', { name: /Session question/ })).toBeNull()
})

test('a missing session says so even when the Processing read fails', async () => {
  const missing = client(() =>
    Promise.reject(new IntakeRequestError(404, 'session_not_found', 'Session not found')),
  )
  missing.read.mockRejectedValue(new Error('offline'))
  mount(missing)
  expect(await screen.findByText('This session was not found.')).toBeInTheDocument()
})

test('each attempt divider says how that attempt ended', async () => {
  const first = attemptHeader({
    state: 'cancelled',
    session_state: 'cancelled',
    ended: { at: at(9), source: 'transition' },
  })
  const second = attemptHeader({
    id: H.attempt2,
    number: 2,
    queued_at: at(10),
    started_because: null,
  })
  mount(
    client(
      history([status(1, 11, 'Again', { attempt: 2, id: `outbox:${H.attempt2}:1` })], {
        attempts: [first, second],
      }),
    ),
  )
  const list = await screen.findByRole('list', { name: 'Session conversation' })

  expect(list).toHaveTextContent(/Cancelled · ended/)
  expect(list).toHaveTextContent(/Running/)
})

test('the header spans from the first attempt’s queue time, and an end with no transition reads as last activity', async () => {
  const first = attemptHeader({
    state: 'failed',
    session_state: 'failed',
    ended: { at: at(9), source: 'last_activity' },
  })
  const second = attemptHeader({
    id: H.attempt2,
    number: 2,
    queued_at: at(10),
    started_because: null,
    state: 'cancelled',
    session_state: 'cancelled',
    ended: { at: at(12), source: 'last_activity' },
  })
  mount(
    client(
      history([status(1, 11, 'Again', { attempt: 2, id: `outbox:${H.attempt2}:1` })], {
        attempts: [first, second],
      }),
    ),
  )
  const header = await screen.findByRole('region', { name: 'Research · ATmega328P' })

  // The read lists attempt 2 first; the span still starts at attempt 1's queue time.
  const headerTimes = [...header.querySelectorAll('time')].map((time) => time.dateTime)
  expect(headerTimes).toEqual([at(1), at(12)])
  expect(header).toHaveTextContent(/last activity/)
  expect(header).not.toHaveTextContent(/ to /)
  const list = screen.getByRole('list', { name: 'Session conversation' })

  const divider = (name: string) => within(list).getByRole('separator', { name }).parentElement!

  const dividerTimes = (name: string) =>
    [...divider(name).querySelectorAll('time')].map((time) => time.dateTime)

  expect(divider('Attempt 1 · first attempt')).toHaveTextContent(/Failed · last activity/)
  expect(dividerTimes('Attempt 1 · first attempt')).toEqual([at(1), at(9)])
  expect(divider('Attempt 2')).toHaveTextContent(/Cancelled · last activity/)
  expect(dividerTimes('Attempt 2')).toEqual([at(10), at(12)])
})

test('a refresh that drops a question keeps its unsaved answer on the page', async () => {
  const user = userEvent.setup()
  let page = history([asked])
  const processing = client(() => Promise.resolve(page))
  const { invalidate } = mount(processing)
  const card = await screen.findByRole('form', {
    name: 'Session question: Which ATmega328P variant is this?',
  })
  await user.click(within(card).getByRole('radio', { name: /ATmega328PB-AU/ }))

  // More than a page arrived and the question was answered elsewhere.
  const answered = structuredClone(snapshot)
  answered.jobs[0].questions[0].state = 'answered'
  processing.read.mockResolvedValue(answered)
  page = history([status(9, 30, 'Much later')], { before: 'older-9' })
  await invalidate()
  await screen.findByText('Much later')

  const kept = screen.getByRole('form', {
    name: 'Session question: Which ATmega328P variant is this?',
  })
  expect(within(kept).getByRole('radio', { name: /ATmega328PB-AU/ })).toBeChecked()
})

test('messages wait for the page’s own Processing read, while the history stays shown', async () => {
  const user = userEvent.setup()
  const processing = client(history([status(1, 1, 'Reading the slip')]))
  const pending = deferred<ProcessingSnapshotDto>()
  processing.read.mockReturnValueOnce(pending.promise)
  mount(processing)
  expect(await screen.findByText('Reading the slip')).toBeInTheDocument()
  const box = screen.getByRole('textbox', { name: 'Message Research' })
  await user.type(box, 'Check the datasheet')
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()

  await act(async () => {
    pending.resolve(snapshot)
    await pending.promise
  })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled())
  expect(box).toHaveValue('Check the datasheet')
})

test('a not-found read replaces history read earlier', async () => {
  let fail = false
  const processing = client(() =>
    fail
      ? Promise.reject(new IntakeRequestError(404, 'session_not_found', 'Session not found'))
      : Promise.resolve(history([status(1, 1, 'Reading the slip')])),
  )
  const { invalidate } = mount(processing)
  await screen.findByText('Reading the slip')
  fail = true
  await invalidate()

  expect(await screen.findByText('This session was not found.')).toBeInTheDocument()
  expect(screen.queryByText('Reading the slip')).toBeNull()
})
