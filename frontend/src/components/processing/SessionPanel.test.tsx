import {
  act,
  cleanup,
  fireEvent,
  render as renderUi,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { ServerStateProvider } from '#/components/query/ServerStateProvider'
import { createServerQueryClient } from '#/queries/client'
import { expect, test, vi } from 'vitest'
import type { ProcessingJobDto, SessionHistoryDto } from '@invimport/contracts'
import { render } from '#/test/render'
import { deferred } from '#/test/deferred'
import {
  H,
  at,
  attemptHeader,
  chat,
  history,
  input,
  photoView,
  proposal,
  reply,
  status,
} from '#/test/session-history'
import { SessionPanel } from './SessionPanel'

const job = {
  id: H.job,
  stage: 'research',
  attempt_id: H.attempt,
  session_state: 'running',
} as ProcessingJobDto

function mount(
  read: () => Promise<SessionHistoryDto>,
  chat: () => Promise<{ seq: string; item_id: string }> = () =>
    Promise.resolve({ seq: '9', item_id: H.inboxItem }),
) {
  const client = { history: vi.fn(read), chat: vi.fn(chat) }
  const cache = createServerQueryClient()
  render(<SessionPanel batchId={H.batch} job={job} client={client} startFresh={vi.fn()} />, {
    cache,
  })
  return Object.assign(client, { cache })
}

function send(text: string) {
  fireEvent.change(screen.getByLabelText('Message Research'), { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
}

test('a session’s history shows a skeleton, not a loading line, until it is read', async () => {
  const page = deferred<SessionHistoryDto>()
  mount(() => page.promise)

  expect(screen.queryByText(/Loading session/)).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Loading')
  await act(async () => {
    page.reject(new Error('offline'))
    await page.promise.catch(() => undefined)
  })
  expect(await screen.findByText(/Session history is unavailable\./)).toBeVisible()
  expect(screen.getByRole('link', { name: 'Open full session' })).toBeInTheDocument()
})

test('the drawer reads only the newest page and folds photo views and web reads into one line', async () => {
  const client = mount(() =>
    Promise.resolve(
      history(
        [
          ...proposal(6, 6, { pages: [] }),
          ...proposal(5, 5, {
            pages: ['https://a.example/1', 'https://b.example/2', 'https://c.example/3'],
          }).slice(1),
          photoView(4, 4),
          photoView(3, 3),
          reply(2, 2, 'On it.'),
          chat(1, 1, 'Check the datasheet'),
          status(1, 1, 'Reading the slip'),
        ],
        { before: 'older' },
      ),
    ),
  )
  const list = await screen.findByRole('list', { name: 'Session history' })

  expect(client.history).toHaveBeenCalledTimes(1)
  expect(client.history).toHaveBeenCalledWith(H.batch, H.job)
  expect(list).toHaveTextContent('Read 3 web pages · viewed 2 photos · see full session')
  // Messages sit in the history in their place; there is no separate message list.
  expect(within(list).getByText('Check the datasheet')).toBeInTheDocument()
  expect(within(list).getByText('On it.')).toBeInTheDocument()
  expect(screen.queryByRole('log')).toBeNull()
  expect(screen.getByText('Older entries are on the full session page.')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Open full session' })).toHaveAttribute(
    'href',
    `#${H.batch}/processing/research/sessions/${H.job}`,
  )
})

test('a failed current attempt shows its failure summary from the history metadata', async () => {
  mount(() =>
    Promise.resolve(
      history([status(1, 1, 'Stopped')], {
        attempts: [
          attemptHeader({
            state: 'failed',
            session_state: 'failed',
            failure: {
              id: H.failure,
              category: 'provider_network',
              summary: 'The provider connection or protocol failed.',
              recovery: 'Start a fresh session later.',
              details_available: false,
              cause: {
                code: 'agent_turn_failed',
                provider: 'claude',
                provider_error: { kind: 'overloaded', result: null, http_status: 529 },
              },
            },
          }),
        ],
      }),
    ),
  )

  expect(
    await screen.findByText("Couldn't reach Claude: the API was overloaded (HTTP 529)"),
  ).toBeInTheDocument()
})

/** A Research session's newest page: two lots with a message, a reply and an answer between. */
function conversationPage(waiting = false) {
  return history(
    [
      status(4, 6, 'Checking packet A'),
      input(
        3,
        5,
        {
          kind: 'answer',
          answer: {
            question_id: H.question,
            answer_id: H.inboxItem,
            steps: [
              {
                step_id: 'labels',
                value: { kind: 'choice', option_id: 'mix', label: 'A mixture' },
              },
            ],
          },
          effects: [{ kind: 'note', subject_id: H.lot }],
        },
        {
          links: [
            {
              kind: 'question',
              question_id: H.question,
              label: 'Do the photos show the same parts?',
            },
          ],
        },
      ),
      status(3, 4, 'Formed 1N2904, code 344'),
      reply(2, 4, 'Thanks, one lot of 10.'),
      chat(2, 4, 'The yellow ones are from one reel.'),
      status(2, 3, 'Recorded 10 observations'),
      status(1, 3, 'Formed 1N2904, code 409'),
    ],
    {
      attempts: [
        waiting
          ? attemptHeader({ state: 'waiting_for_user', session_state: 'waiting_input' })
          : attemptHeader(),
      ],
    },
  )
}

function rows(list: HTMLElement) {
  return [...list.children] as HTMLElement[]
}

test('the drawer shows messages, replies and answers in one list in history order', async () => {
  mount(() => Promise.resolve(conversationPage()))
  const list = await screen.findByRole('list', { name: 'Session history' })
  const text = rows(list).map((row) => row.textContent)
  expect(text[0]).toContain('Formed 1N2904, code 409')
  expect(text[1]).toContain('Recorded 10 observations')
  // Equal times keep the read's order: the message, then its reply.
  expect(text[2]).toMatch(/^You.*The yellow ones are from one reel\./)
  expect(text[3]).toMatch(/^Research.*Thanks, one lot of 10\./)
  expect(text[4]).toContain('Formed 1N2904, code 344')
  // The answer shows once, quoting the question with a link to it, its effect beside its time.
  expect(text[5]).toMatch(/^YouResearch asked/)
  expect(
    within(rows(list)[5]).getByRole('link', { name: 'Do the photos show the same parts?' }),
  ).toHaveAttribute('href', `#${H.batch}/processing/research/${H.question}`)
  expect(text[5]).toContain('A mixture')
  expect(text[5]).toContain('Note added')
  expect(screen.getAllByText('A mixture')).toHaveLength(1)
  expect(screen.queryByText(/^Answered:/)).toBeNull()
})

test('the rail dots each action, none on bubbles, solid between actions and dashed across bubbles', async () => {
  mount(() => Promise.resolve(conversationPage()))
  const list = await screen.findByRole('list', { name: 'Session history' })
  const marks = rows(list).map((row) => [
    row.dataset.rail ?? '-',
    row.dataset.line ?? '-',
    row.dataset.now ? 'now' : '-',
  ])
  expect(marks).toEqual([
    ['action', 'solid', '-'],
    ['action', 'dashed', '-'],
    ['-', 'dashed', '-'],
    ['-', 'dashed', '-'],
    ['action', 'dashed', '-'],
    ['-', 'dashed', '-'],
    ['action', '-', 'now'],
  ])
  // The live region still names the current activity for screen readers.
  expect(screen.getByRole('status', { hidden: true })).toHaveTextContent(
    'Current activity: Checking packet A',
  )
  // Under reduced motion the now dot's ring stands still.
  const css = [...document.querySelectorAll('style')].map((style) => style.textContent).join('')
  expect(css).toMatch(/prefers-reduced-motion: reduce\)\{[^}]*animation:none/)
})

test('the latest action is a plain dot while the session waits', async () => {
  mount(() => Promise.resolve(conversationPage(true)))
  const list = await screen.findByRole('list', { name: 'Session history' })
  expect(rows(list).some((row) => row.dataset.now)).toBe(false)
  expect(rows(list).at(-1)?.dataset.rail).toBe('action')
})

test('a message being sent shows last with “Sending…” until the read returns it', async () => {
  const sent = deferred<{ seq: string; item_id: string }>()
  mount(
    () => Promise.resolve(conversationPage()),
    () => sent.promise,
  )
  const list = await screen.findByRole('list', { name: 'Session history' })
  send('Is the date code readable?')
  const last = await within(list).findByRole('listitem', { name: 'Your message, sending' })
  expect(last).toHaveTextContent('You')
  expect(last).toHaveTextContent('Is the date code readable?')
  expect(last).toHaveTextContent('Sending…')
  expect(rows(list).at(-1)).toBe(last)
  await act(async () => {
    sent.resolve({ seq: '9', item_id: H.inboxItem })
    await sent.promise
  })
  expect(within(list).queryByRole('listitem', { name: 'Your message, sending' })).toBeNull()
})

test('a message the read holds before its send returns shows once, never twice', async () => {
  const sent = deferred<{ seq: string; item_id: string }>()
  let page = conversationPage()
  const client = mount(
    () => Promise.resolve(page),
    () => sent.promise,
  )
  const list = await screen.findByRole('list', { name: 'Session history' })
  send('Is the date code readable?')
  await within(list).findByRole('listitem', { name: 'Your message, sending' })

  // A live read lands with the saved row before the send's response does.
  page = history([chat(9, 7, 'Is the date code readable?'), ...conversationPage().entries], {
    attempts: conversationPage().session.attempts,
  })
  await act(async () => {
    await client.cache.refetchQueries()
  })
  await waitFor(() =>
    expect(within(list).getAllByText('Is the date code readable?')).toHaveLength(1),
  )
  expect(within(list).queryByRole('listitem', { name: /^Your message/ })).toBeNull()
  await act(async () => {
    sent.resolve({ seq: '9', item_id: H.inboxItem })
    await sent.promise
  })
  expect(within(list).getAllByText('Is the date code readable?')).toHaveLength(1)
})

test('a message read before its receipt stays gone once agent actions push it off the page', async () => {
  const sent = deferred<{ seq: string; item_id: string }>()
  let page = conversationPage()
  const client = mount(
    () => Promise.resolve(page),
    () => sent.promise,
  )
  const list = await screen.findByRole('list', { name: 'Session history' })
  send('Is the date code readable?')
  await within(list).findByRole('listitem', { name: 'Your message, sending' })
  page = history([chat(9, 7, 'Is the date code readable?'), ...conversationPage().entries], {
    attempts: conversationPage().session.attempts,
  })
  await act(async () => {
    await client.cache.refetchQueries()
  })
  await act(async () => {
    sent.resolve({ seq: '9', item_id: H.inboxItem })
    await sent.promise
  })

  // The newest page now holds only newer agent actions: no inbox row at all.
  page = history([status(40, 30, 'Still working'), status(39, 29, 'Checking the label')], {
    attempts: conversationPage().session.attempts,
  })
  await act(async () => {
    await client.cache.refetchQueries()
  })
  await within(list).findByText('Still working')
  expect(within(list).queryByText('Is the date code readable?')).toBeNull()
  expect(within(list).queryByRole('listitem', { name: /^Your message/ })).toBeNull()
})

test('a send whose own refresh finds only newer agent actions is not shown again', async () => {
  let page = conversationPage()
  const client = mount(() => Promise.resolve(page))
  const list = await screen.findByRole('list', { name: 'Session history' })
  // The refresh after the receipt returns a page that newer actions have filled.
  page = history([status(40, 30, 'Still working'), status(39, 29, 'Checking the label')], {
    attempts: conversationPage().session.attempts,
  })
  send('Is the date code readable?')
  await within(list).findByText('Still working')
  expect(client.history).toHaveBeenCalledTimes(2)
  expect(within(list).queryByText('Is the date code readable?')).toBeNull()
})

test('a saved message whose refresh fails stays shown as saved until a read holds it', async () => {
  let page: () => Promise<SessionHistoryDto> = () => Promise.resolve(conversationPage())

  const client = mount(() => page())
  const list = await screen.findByRole('list', { name: 'Session history' })
  page = () => Promise.reject(new Error('offline'))
  send('Is the date code readable?')

  const saved = await within(list).findByRole('listitem', { name: 'Your message, saved' })
  expect(saved).toHaveTextContent('Saved')
  page = () =>
    Promise.resolve(
      history([chat(9, 7, 'Is the date code readable?'), ...conversationPage().entries], {
        attempts: conversationPage().session.attempts,
      }),
    )
  await act(async () => {
    await client.cache.refetchQueries()
  })
  await waitFor(() =>
    expect(within(list).queryByRole('listitem', { name: /^Your message/ })).toBeNull(),
  )
  expect(within(list).getAllByText('Is the date code readable?')).toHaveLength(1)
})

test('two sends before a read both stay shown, and a held row never comes back as pending', async () => {
  const replies = [
    { seq: '9', item_id: H.inboxItem },
    { seq: '10', item_id: H.inboxItem },
  ]

  let page: () => Promise<SessionHistoryDto> = () => Promise.resolve(conversationPage())

  const client = mount(
    () => page(),
    () => Promise.resolve(replies.shift()!),
  )
  const list = await screen.findByRole('list', { name: 'Session history' })
  page = () => Promise.reject(new Error('offline'))
  send('First message')
  await within(list).findByRole('listitem', { name: 'Your message, saved' })
  send('Second message')
  await waitFor(() =>
    expect(within(list).getAllByRole('listitem', { name: 'Your message, saved' })).toHaveLength(2),
  )

  const held = history(
    [chat(10, 8, 'Second message'), chat(9, 7, 'First message'), ...conversationPage().entries],
    { attempts: conversationPage().session.attempts },
  )
  page = () => Promise.resolve(held)
  await act(async () => {
    await client.cache.refetchQueries()
  })
  await waitFor(() =>
    expect(within(list).queryByRole('listitem', { name: /^Your message/ })).toBeNull(),
  )
  // Once newer rows push them off the newest page, they don't reappear as pending.
  const rolled = history([chat(11, 9, 'A later message'), status(5, 8, 'Still working')], {
    attempts: conversationPage().session.attempts,
  })
  page = () => Promise.resolve(rolled)
  await act(async () => {
    await client.cache.refetchQueries()
  })
  await waitFor(() => expect(within(list).queryByText('First message')).toBeNull())
  expect(within(list).queryByRole('listitem', { name: /^Your message/ })).toBeNull()
})

test('a pending message stays with its server scope', async () => {
  const sent = deferred<{ seq: string; item_id: string }>()
  mount(
    () => Promise.resolve(conversationPage()),
    () => sent.promise,
  )
  await screen.findByRole('list', { name: 'Session history' })
  send('Only in this scope')
  await screen.findByRole('listitem', { name: 'Your message, sending' })
  cleanup()

  // Another origin serving the same batch and job IDs shows none of it.
  const client = { history: vi.fn(() => Promise.resolve(conversationPage())), chat: vi.fn() }
  renderUi(
    <ServerStateProvider
      scope={{
        origin: 'http://elsewhere.test',
        actorId: H.part,
        targetId: H.proposal,
        targetContextId: H.failure,
      }}
    >
      <SessionPanel batchId={H.batch} job={job} client={client} startFresh={vi.fn()} />
    </ServerStateProvider>,
  )
  await screen.findByRole('list', { name: 'Session history' })
  expect(screen.queryByText('Only in this scope')).toBeNull()
})

test('a send that fails after its scope ended does not come back when the scope returns', async () => {
  const sent = deferred<{ seq: string; item_id: string }>()
  mount(
    () => Promise.resolve(conversationPage()),
    () => sent.promise,
  )
  await screen.findByRole('list', { name: 'Session history' })
  send('Sent before leaving')
  await screen.findByRole('listitem', { name: 'Your message, sending' })
  cleanup()
  await act(async () => {
    sent.reject(new Error('offline'))
    await sent.promise.catch(() => undefined)
  })

  mount(() => Promise.resolve(conversationPage()))
  await screen.findByRole('list', { name: 'Session history' })
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.queryByText(/Sent before leaving/)).toBeNull()
  fireEvent.change(screen.getByLabelText('Message Research'), { target: { value: 'Again' } })
  expect(screen.getByRole('button', { name: 'Send' })).not.toBeDisabled()
})

test('the header says where a retried session stands, from its history', async () => {
  const attempts = [
    attemptHeader({
      id: '00000000-0000-4000-8000-0000000000a1',
      number: 1,
      state: 'failed',
      session_state: 'failed',
      queued_at: at(2),
      ended: { at: at(4), source: 'transition' },
    }),
    attemptHeader({
      id: '00000000-0000-4000-8000-0000000000a2',
      number: 2,
      state: 'failed',
      session_state: 'failed',
      queued_at: at(5),
      started_because: 'after_failure',
      ended: { at: at(6), source: 'transition' },
    }),
    attemptHeader({
      number: 3,
      state: 'ready',
      session_state: 'finished',
      queued_at: at(7),
      started_because: 'after_failure',
      ended: { at: at(13), source: 'transition' },
    }),
  ]
  mount(() => Promise.resolve(history([status(1, 12, 'Checked the datasheet')], { attempts })))

  const header = await screen.findByRole('region', { name: 'Session details' })
  expect(header).toHaveTextContent('Claude Opus 5.5 · agent VM · web on')
  const times = within(header)
    .getAllByRole('time', { hidden: true })
    .map((time) => time.getAttribute('datetime'))
  // The span runs from the first attempt's queue time to the current attempt's end; the
  // earlier attempts' own times follow in their fold.
  expect(times.slice(0, 2)).toEqual([at(2), at(13)])
  expect(header).toHaveTextContent('Attempt 3 ·')
  expect(within(header).getByText('2 earlier failed')).toBeVisible()
  expect(within(header).getByRole('link', { name: 'Open full session' })).toBeVisible()
  expect(screen.getAllByRole('link', { name: 'Open full session' })).toHaveLength(1)
})

test('a first attempt shows no retry line, and a session on this computer says so', async () => {
  const attempts = [attemptHeader({ runs_on: 'host', profile_id: 'claude-session/2', web: null })]
  mount(() => Promise.resolve(history([], { attempts })))

  const header = await screen.findByRole('region', { name: 'Session details' })
  expect(header).toHaveTextContent('Claude Opus 5.5 · this computer · no web')
  expect(header).not.toHaveTextContent('Attempt')
})
