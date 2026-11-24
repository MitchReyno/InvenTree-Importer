import { act, screen, within } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import type { ProcessingJobDto, SessionHistoryDto } from '@invimport/contracts'
import { render } from '#/test/render'
import { deferred } from '#/test/deferred'
import {
  H,
  attemptHeader,
  chat,
  history,
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

function mount(read: () => Promise<SessionHistoryDto>) {
  const client = { history: vi.fn(read), chat: vi.fn() }
  render(<SessionPanel batchId={H.batch} job={job} client={client} startFresh={vi.fn()} />)
  return client
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
  // Chat stays in the chat, not the history.
  expect(within(list).queryByText('Check the datasheet')).toBeNull()
  expect(screen.getByRole('log', { name: 'Session messages' })).toHaveTextContent('On it.')
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
              summary: 'The provider was overloaded.',
              recovery: 'Start a fresh session later.',
              details_available: false,
            },
          }),
        ],
      }),
    ),
  )

  expect(await screen.findByText(/The provider was overloaded\./)).toBeInTheDocument()
})
