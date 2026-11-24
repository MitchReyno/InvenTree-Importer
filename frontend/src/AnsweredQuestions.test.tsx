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
import { attemptHeader, history as sessionHistory } from '#/test/session-history'

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
      sessionHistory([], { attempts: [attemptHeader({ state: 'running', session_state: 'running' })] }),
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
}: {
  client: ProcessingClient
  view?: ProcessingView
  questionId?: string
  remount?: boolean
  outcomes: ReturnType<typeof createAnswerOutcomes>
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

function mount(client: ProcessingClient, props: { questionId?: string; remount?: boolean } = {}) {
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
  await waitFor(() => expect(screen.getByRole('heading', { name: /^Answered/ })).toHaveFocus())
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
  await waitFor(() =>
    expect(screen.getByRole('link', { name: new RegExp(questionPrompt) })).toHaveFocus(),
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
