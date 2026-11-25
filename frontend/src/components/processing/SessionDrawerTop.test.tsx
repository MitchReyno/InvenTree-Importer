import { screen, within } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import type { ProcessingJobDto, SessionHistoryDto } from '@invimport/contracts'
import { createServerQueryClient } from '#/queries/client'
import { render } from '#/test/render'
import { H, at, attemptHeader, history, status } from '#/test/session-history'
import { SessionDrawerTop } from './SessionDrawerTop'

const job = {
  id: H.job,
  stage: 'research',
  attempt_id: H.attempt,
  session_state: 'running',
} as ProcessingJobDto

function mount(read: () => Promise<SessionHistoryDto>) {
  render(<SessionDrawerTop batchId={H.batch} job={job} read={vi.fn(read)} />, {
    cache: createServerQueryClient(),
  })
}

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
  expect(within(header).getByRole('link', { name: 'Open full session' })).toHaveAttribute(
    'href',
    `#${H.batch}/processing/research/sessions/${H.job}`,
  )
})

test('a first attempt shows no retry line, and a session on this computer says so', async () => {
  const attempts = [attemptHeader({ runs_on: 'host', profile_id: 'claude-session/2', web: null })]
  mount(() => Promise.resolve(history([], { attempts })))

  const header = await screen.findByRole('region', { name: 'Session details' })
  expect(header).toHaveTextContent('Claude Opus 5.5 · this computer · no web')
  expect(header).not.toHaveTextContent('Attempt')
})

test('after a switch to a profile without sessions, the header counts only attempts before the one shown', async () => {
  const attempts = [
    attemptHeader({
      id: '00000000-0000-4000-8000-0000000000b1',
      number: 1,
      state: 'failed',
      session_state: 'failed',
      ended: { at: at(4), source: 'transition' },
    }),
    attemptHeader({
      number: 2,
      state: 'superseded',
      session_state: 'finished',
      queued_at: at(5),
      started_because: 'after_failure',
    }),
  ]
  const page = history([], { attempts })
  // The job's current attempt has no session, so the history names an attempt it doesn't list.
  page.session.current_attempt_id = '00000000-0000-4000-8000-0000000000b3'
  mount(() => Promise.resolve(page))

  const header = await screen.findByRole('region', { name: 'Session details' })
  expect(header).toHaveTextContent('Attempt 2 ·')
  expect(within(header).getByText('1 earlier failed')).toBeVisible()
})

test('a cancelled session says so rather than not started', async () => {
  mount(() =>
    Promise.resolve(
      history([status(1, 3, 'Reading the label')], {
        attempts: [attemptHeader({ state: 'cancelled', session_state: 'cancelled' })],
      }),
    ),
  )
  const header = await screen.findByRole('region', { name: 'Session details' })
  expect(header).toHaveTextContent('Cancelled')
  expect(header).not.toHaveTextContent('Not started')
})

test('a replaced attempt shown after a profile switch reads as replaced, not queued', async () => {
  const page = history([], {
    attempts: [attemptHeader({ state: 'superseded', session_state: 'finished' })],
  })
  page.session.current_attempt_id = '00000000-0000-4000-8000-0000000000c3'
  mount(() => Promise.resolve(page))
  const header = await screen.findByRole('region', { name: 'Session details' })
  expect(header).toHaveTextContent('Replaced')
  expect(header).not.toHaveTextContent('Queued')
})
