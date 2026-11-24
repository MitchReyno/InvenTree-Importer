import { act, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import type { SessionTimelineDto } from '@invimport/contracts'
import { render } from '#/test/render'
import { deferred } from '#/test/deferred'
import { SessionPanel } from './SessionPanel'

test('a session’s history shows a skeleton, not a loading line, until it is read', async () => {
  const timeline = deferred<SessionTimelineDto>()
  const client = {
    session: vi.fn(() => timeline.promise),
    chat: vi.fn(),
  }
  render(
    <SessionPanel
      batchId="batch"
      job={{ id: 'job' } as never}
      client={client}
      startFresh={vi.fn()}
    />,
  )

  expect(screen.queryByText(/Loading session/)).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Loading')
  await act(async () => {
    timeline.reject(new Error('offline'))
    await timeline.promise.catch(() => undefined)
  })
  expect(await screen.findByText('Session history is unavailable.')).toBeVisible()
})
