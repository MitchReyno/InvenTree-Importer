import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { expect, test, vi } from 'vitest'
import {
  validate,
  type CaptureSnapshotDto,
  type ProcessingQuestionDto,
  type ProcessingSnapshotDto,
} from '@invimport/contracts'
import { ProcessingWorkspace } from './components/processing/ProcessingWorkspace'
import { ServerStateProvider } from './components/query/ServerStateProvider'
import { createServerQueryClient } from './queries/client'
import { serverQueryKey, type ServerScope } from './queries/scope'
import type { ProcessingClient, ProcessingView } from './processing/types'
import { createDrawerRestore } from './processing/drawer-restore'
import { createAnswerOutcomes } from './processing/answer-outcomes'
import { answered, choiceQuestion, fullAnswer, Q } from '#/test/answered-questions'
import { attemptHeader, history as sessionHistory, question } from '#/test/session-history'

// Each test mounts the whole Processing workspace, which a busy machine renders slowly.
vi.setConfig({ testTimeout: 15000 })

const batchId = '10000000-0000-4000-8000-000000000001'
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
      id: Q.lot,
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

/** The Examine lead session, running, with the given questions. */
function examineRead(questions: ProcessingQuestionDto[], captureRevision = '8') {
  const value: ProcessingSnapshotDto = {
    batch_id: batchId,
    capture_revision: captureRevision,
    runner_status: 'fixture_only',
    cursor: batch.cursor,
    jobs: [
      {
        id: Q.job,
        subject_id: null,
        stage: 'examine',
        revision: '2',
        state: 'running',
        attempt_id: Q.attempt,
        input_sha256: 'a'.repeat(64),
        attempt_number: '1',
        qualification: 'fixture_only',
        session_state: 'running',
        proposals: [],
        questions,
      },
    ],
  }
  validate('ProcessingSnapshot', value)
  return value
}

const lead = (n: number) => choiceQuestion(n, { subject_id: null })

function clientFor(read: ProcessingSnapshotDto) {
  return {
    read: vi.fn().mockResolvedValue(read),
    start: vi.fn(),
    cancel: vi.fn(),
    answer: vi.fn().mockResolvedValue({
      answer_id: Q.answer,
      question_id: Q.question(5),
      attempt_id: Q.attempt,
      capture_revision: '9',
      command_id: 'd0000000-0000-4000-8000-000000000004',
    }),
    history: vi.fn().mockResolvedValue(
      sessionHistory([], {
        attempts: [attemptHeader({ state: 'running', session_state: 'running' })],
      }),
    ),
    chat: vi.fn(),
  } satisfies ProcessingClient
}

/** Stands in for Batch: saving an answer re-keys Processing; the stores live above that key. */
function Harness({
  client,
  view = 'examine',
  questionId,
  remount = true,
  outcomes,
  sessionPageJobId,
}: {
  client: ProcessingClient
  view?: ProcessingView
  questionId?: string
  remount?: boolean
  outcomes: ReturnType<typeof createAnswerOutcomes>
  sessionPageJobId?: string
}) {
  const [reset, setReset] = useState(0)
  const [drawerRestore] = useState(createDrawerRestore)

  return (
    <ProcessingWorkspace
      key={reset}
      batch={batch}
      client={client}
      view={view}
      questionId={questionId}
      sessionPageJobId={sessionPageJobId}
      navigate={vi.fn()}
      onDirtyChange={vi.fn()}
      onSaved={async () => {
        if (!remount) {
          throw new Error('capture_unavailable')
        }
        drawerRestore.carry()
        setReset((count) => count + 1)
      }}
      drawerRestore={drawerRestore}
      answerOutcomes={outcomes}
    />
  )
}

function mount(
  client: ProcessingClient,
  props: { questionId?: string; remount?: boolean; sessionPageJobId?: string } = {},
) {
  const cache = createServerQueryClient()
  const outcomes = createAnswerOutcomes()
  render(
    <ServerStateProvider scope={scope} client={cache}>
      <Harness client={client} outcomes={outcomes} {...props} />
    </ServerStateProvider>,
  )
  return { cache, outcomes, key: serverQueryKey(scope, 'processing', batchId) }
}

const questionPrompt = 'Are package labels reliable descriptions of their current contents?'

async function answerContentsVerified() {
  const user = userEvent.setup()
  const form = await screen.findByRole('form', { name: 'Pinned application question' })
  await user.click(within(form).getByRole('radio', { name: /Contents verified/ }))
  await user.click(within(form).getByRole('button', { name: 'Send answer' }))
}

function answeredGroup() {
  return screen.getByRole('region', { name: 'Answered' })
}

test('answering on the step page shows it answered after the read and the remount, never superseded', async () => {
  const client = clientFor(examineRead([lead(5)]))
  mount(client, { questionId: Q.question(5) })
  client.read.mockResolvedValue(
    examineRead([answered(lead(5), fullAnswer('Contents verified'))], '9'),
  )
  await answerContentsVerified()

  await waitFor(() => expect(answeredGroup()).toHaveTextContent('You chose Contents verified'))
  expect(answeredGroup()).toHaveTextContent('waiting for Examine to read it')
  expect(screen.queryByRole('form', { name: 'Pinned application question' })).toBeNull()
  expect(document.body).not.toHaveTextContent('superseded')
  // Nothing else is open, so focus goes to the Answered heading.
  await waitFor(() => expect(screen.getByRole('heading', { name: /^Answered/ })).toHaveFocus(), {
    timeout: 5000,
  })
})

test('the step page never pins an answered question into a form on a direct load', async () => {
  const client = clientFor(examineRead([answered(lead(5), fullAnswer('Contents verified'))]))
  mount(client, { questionId: Q.question(5) })
  await waitFor(() => expect(answeredGroup()).toHaveTextContent('You chose Contents verified'))
  expect(screen.queryByRole('form', { name: 'Pinned application question' })).toBeNull()
  expect(document.body).not.toHaveTextContent('superseded')
})

test('a confirmed answer shows as saved when the read after it fails, and focus moves on', async () => {
  const client = clientFor(examineRead([lead(5), lead(6)]))
  mount(client, { questionId: Q.question(5), remount: false })
  client.read.mockRejectedValue(new Error('offline'))
  await answerContentsVerified()

  await waitFor(() => expect(answeredGroup()).toHaveTextContent('You chose Contents verified'))
  expect(answeredGroup()).toHaveTextContent('saved')
  expect(screen.queryByRole('form', { name: 'Pinned application question' })).toBeNull()
  // The other open question's row takes focus.
  await waitFor(
    () => expect(screen.getByRole('link', { name: new RegExp(questionPrompt) })).toHaveFocus(),
    { timeout: 5000 },
  )
})

test('the confirmed outcome gives way to a fresh read in the state-only tier', async () => {
  const client = clientFor(examineRead([lead(5)]))
  const { cache, key, outcomes } = mount(client, { questionId: Q.question(5), remount: false })
  client.read.mockRejectedValueOnce(new Error('offline'))
  await answerContentsVerified()
  await waitFor(() => expect(answeredGroup()).toHaveTextContent('saved'))

  client.read.mockResolvedValue(examineRead([answered(lead(5))], '9'))
  await act(async () => {
    await cache.refetchQueries({ queryKey: key })
  })
  await waitFor(() => expect(answeredGroup()).toHaveTextContent('Answered · see the session'))
  expect(outcomes.get(Q.question(5))).toBeUndefined()
})

test('sending locks the form without folding it; no answer keeps it open and Try again resends the same key', async () => {
  const user = userEvent.setup()
  const client = clientFor(examineRead([lead(5)]))

  let fail: (error: Error) => void = () => {}

  client.answer.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject
      }),
  )
  mount(client, { questionId: Q.question(5) })
  await answerContentsVerified()
  const form = screen.getByRole('form', { name: 'Pinned application question' })
  expect(within(form).getByText(/^Sending…/)).toBeInTheDocument()
  expect(within(form).getByRole('radio', { name: /Contents verified/ })).toBeDisabled()
  expect(screen.queryByRole('region', { name: 'Answered' })).toBeNull()

  await act(async () => {
    fail(new Error('lost acknowledgement'))
  })
  expect(await within(form).findByText(/Not sent: the server didn’t answer/)).toBeInTheDocument()
  expect(within(form).getByRole('radio', { name: /Contents verified/ })).toBeChecked()
  await user.click(within(form).getByRole('button', { name: 'Try again' }))
  await waitFor(() => expect(client.answer).toHaveBeenCalledTimes(2))
  expect(client.answer.mock.calls[1]).toEqual(client.answer.mock.calls[0])
})

test('a step page pinned to a replaced question links the newer one, with no form', async () => {
  const replaced = {
    ...lead(5),
    state: 'superseded' as const,
    revision: '2',
    replaced_by: Q.question(7),
  }
  mount(clientFor(examineRead([replaced, lead(7)])), { questionId: Q.question(5) })
  const card = await screen.findByText(/Replaced by a newer question/)
  expect(within(card.closest('[role="status"]')!).getByRole('link')).toHaveAttribute(
    'href',
    `#${batchId}/processing/examine/${Q.question(7)}`,
  )
  expect(screen.queryByRole('form', { name: 'Pinned application question' })).toBeNull()
})

test('a question closed by Start fresh reads “No longer asked”, linking the session, not the open one', async () => {
  const closed = { ...lead(5), state: 'superseded' as const, revision: '2' }
  mount(clientFor(examineRead([closed, lead(7)])), { questionId: Q.question(5) })
  const card = (await screen.findByText(/No longer asked/)).closest('[role="status"]')!
  const links = within(card as HTMLElement).getAllByRole('link')
  expect(links).toHaveLength(1)
  expect(links[0]).toHaveAttribute('href', `#${batchId}/processing/examine/sessions/${Q.job}`)
  expect(screen.queryByRole('form', { name: 'Pinned application question' })).toBeNull()
})

test('a drawer with no draft shows a question answered elsewhere as its Answered line', async () => {
  const client = clientFor(examineRead([lead(5)]))
  history.replaceState(null, '', `#${batchId}/processing/examine?session=${Q.job}`)
  const cache = createServerQueryClient()
  const outcomes = createAnswerOutcomes()
  render(
    <ServerStateProvider scope={scope} client={cache}>
      <ProcessingWorkspace
        batch={batch}
        client={client}
        view="examine"
        sessionId={Q.job}
        navigate={vi.fn()}
        onDirtyChange={vi.fn()}
        onSaved={vi.fn().mockResolvedValue(undefined)}
        answerOutcomes={outcomes}
      />
    </ServerStateProvider>,
  )
  const drawer = await screen.findByRole('dialog')
  await within(drawer).findByRole('form', { name: `Session question: ${questionPrompt}` })
  client.read.mockResolvedValue(
    examineRead([answered(lead(5), fullAnswer('Contents verified'))], '9'),
  )
  await act(async () => {
    await cache.refetchQueries({ queryKey: serverQueryKey(scope, 'processing', batchId) })
  })
  await waitFor(() =>
    expect(within(drawer).getByRole('region', { name: 'Answered' })).toHaveTextContent(
      'You chose Contents verified',
    ),
  )
  expect(within(drawer).queryByRole('form', { name: /^Session question/ })).toBeNull()
})

test('when the next question closes during the save, focus falls back to the Answered heading', async () => {
  const client = clientFor(examineRead([lead(5), lead(6)]))
  mount(client, { questionId: Q.question(5) })
  client.read.mockResolvedValue(
    examineRead(
      [
        answered(lead(5), fullAnswer('Contents verified')),
        { ...lead(6), state: 'superseded', revision: '2' },
      ],
      '9',
    ),
  )
  await answerContentsVerified()
  await waitFor(() => expect(screen.getByRole('heading', { name: /^Answered/ })).toHaveFocus(), {
    timeout: 5000,
  })
})

async function openLeadDrawer(read: ProcessingSnapshotDto) {
  const client = clientFor(read)
  const cache = createServerQueryClient()
  render(
    <ServerStateProvider scope={scope} client={cache}>
      <ProcessingWorkspace
        batch={batch}
        client={client}
        view="examine"
        sessionId={Q.job}
        navigate={vi.fn()}
        onDirtyChange={vi.fn()}
        onSaved={vi.fn().mockResolvedValue(undefined)}
      />
    </ServerStateProvider>,
  )
  const drawer = await screen.findByRole('dialog')
  await within(drawer).findByRole('form', { name: `Session question: ${questionPrompt}` })

  const reread = async (next: ProcessingSnapshotDto) => {
    client.read.mockResolvedValue(next)
    await act(async () => {
      await cache.refetchQueries({ queryKey: serverQueryKey(scope, 'processing', batchId) })
    })
  }

  return { drawer, reread }
}

test('a clean drawer form whose question was replaced says so, linking the newer one', async () => {
  const { drawer, reread } = await openLeadDrawer(examineRead([lead(5)]))
  await reread(
    examineRead([
      { ...lead(5), state: 'superseded', revision: '2', replaced_by: Q.question(7) },
      lead(7),
    ]),
  )
  const card = await within(drawer).findByText(/Replaced by a newer question/)
  expect(within(card.closest('[role="status"]') as HTMLElement).getByRole('link')).toHaveAttribute(
    'href',
    `#${batchId}/processing/examine/${Q.question(7)}`,
  )
})

test('a clean drawer form closed by Start fresh reads “No longer asked”', async () => {
  const { drawer, reread } = await openLeadDrawer(examineRead([lead(5)]))
  await reread(examineRead([{ ...lead(5), state: 'superseded', revision: '2' }]))
  expect(await within(drawer).findByText(/No longer asked/)).toBeInTheDocument()
  expect(within(drawer).queryByRole('form', { name: /^Session question/ })).toBeNull()
})

test('a drawer opened after a replacement or a Start fresh still says why each question closed', async () => {
  const client = clientFor(
    examineRead([
      { ...lead(5), state: 'superseded', revision: '2', replaced_by: Q.question(7) },
      { ...lead(6), state: 'superseded', revision: '2' },
      lead(7),
    ]),
  )
  render(
    <ServerStateProvider scope={scope} client={createServerQueryClient()}>
      <ProcessingWorkspace
        batch={batch}
        client={client}
        view="examine"
        sessionId={Q.job}
        navigate={vi.fn()}
        onDirtyChange={vi.fn()}
        onSaved={vi.fn().mockResolvedValue(undefined)}
      />
    </ServerStateProvider>,
  )
  const drawer = await screen.findByRole('dialog')
  expect(await within(drawer).findByText(/Replaced by a newer question/)).toBeInTheDocument()
  expect(within(drawer).getByText(/No longer asked/)).toBeInTheDocument()
})

test('after a page answer remounts, focus waits for the next loaded question’s form', async () => {
  const user = userEvent.setup()
  const client = clientFor(examineRead([lead(5), lead(6)]))
  client.history.mockResolvedValue(
    sessionHistory([question(2, 2, { id: Q.question(6) }), question(1, 1, { id: Q.question(5) })], {
      attempts: [attemptHeader({ state: 'running', session_state: 'running' })],
    }),
  )
  mount(client, { sessionPageJobId: Q.job })
  const first = await waitFor(() => {
    const card = document.querySelector<HTMLElement>(`[data-question-card="${Q.question(5)}"]`)
    expect(card?.querySelector('form')).toBeTruthy()
    return card!
  })
  const remounted = deferredRead()
  client.read
    .mockResolvedValueOnce(
      examineRead([answered(lead(5), fullAnswer('Contents verified')), lead(6)], '9'),
    )
    .mockReturnValueOnce(remounted.promise)
  await user.click(within(first).getByRole('radio', { name: /Contents verified/ }))
  await user.click(within(first).getByRole('button', { name: /^Send/ }))

  // The remount shows the cached read; the next question's form waits for its fresh read.
  await waitFor(() => expect(client.read).toHaveBeenCalledTimes(3))
  expect(screen.queryByRole('heading', { name: /^Answered/ })).not.toHaveFocus()
  await act(async () => {
    remounted.resolve(
      examineRead([answered(lead(5), fullAnswer('Contents verified')), lead(6)], '9'),
    )
    await remounted.promise
  })
  await waitFor(
    () =>
      expect(document.querySelector(`[data-question-card="${Q.question(6)}"] input`)).toHaveFocus(),
    { timeout: 5000 },
  )
})

test('tabbing elsewhere while the next form is awaited keeps focus where the operator put it', async () => {
  const user = userEvent.setup()
  const client = clientFor(examineRead([lead(5), lead(6)]))
  client.history.mockResolvedValue(
    sessionHistory([question(2, 2, { id: Q.question(6) }), question(1, 1, { id: Q.question(5) })], {
      attempts: [attemptHeader({ state: 'running', session_state: 'running' })],
    }),
  )
  mount(client, { sessionPageJobId: Q.job })
  const first = await waitFor(() => {
    const card = document.querySelector<HTMLElement>(`[data-question-card="${Q.question(5)}"]`)
    expect(card?.querySelector('form')).toBeTruthy()
    return card!
  })
  const remounted = deferredRead()
  client.read
    .mockResolvedValueOnce(
      examineRead([answered(lead(5), fullAnswer('Contents verified')), lead(6)], '9'),
    )
    .mockReturnValueOnce(remounted.promise)
  await user.click(within(first).getByRole('radio', { name: /Contents verified/ }))
  await user.click(within(first).getByRole('button', { name: /^Send/ }))
  await waitFor(() => expect(client.read).toHaveBeenCalledTimes(3))

  // The operator moves on before the next form is ready.
  const elsewhere = screen.getAllByRole('link')[0]!
  elsewhere.focus()
  await act(async () => {
    remounted.resolve(
      examineRead([answered(lead(5), fullAnswer('Contents verified')), lead(6)], '9'),
    )
    await remounted.promise
  })
  await waitFor(() =>
    expect(document.querySelector(`[data-question-card="${Q.question(6)}"] form`)).toBeTruthy(),
  )
  expect(elsewhere).toHaveFocus()
})

test('tabbing elsewhere while the answer is being sent keeps focus where the operator put it', async () => {
  const client = clientFor(examineRead([lead(5)]))
  const receipt = deferredValue<Awaited<ReturnType<typeof client.answer>>>()
  const confirmed = await client.answer()
  client.answer.mockReturnValueOnce(receipt.promise)
  mount(client, { questionId: Q.question(5), remount: false })
  client.read.mockResolvedValue(
    examineRead([answered(lead(5), fullAnswer('Contents verified'))], '9'),
  )
  await answerContentsVerified()

  const elsewhere = screen.getByRole('link', { name: 'Evidence in Capture' })
  elsewhere.focus()
  await act(async () => {
    receipt.resolve(confirmed)
    await receipt.promise
  })
  await waitFor(() => expect(answeredGroup()).toHaveTextContent('You chose Contents verified'))
  expect(screen.getByRole('heading', { name: /^Answered/ })).not.toHaveFocus()
  expect(elsewhere).toHaveFocus()
})

function deferredValue<T>() {
  let resolve: (value: T) => void = () => {}

  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

function deferredRead() {
  let resolve: (value: ProcessingSnapshotDto) => void = () => {}

  const promise = new Promise<ProcessingSnapshotDto>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}
