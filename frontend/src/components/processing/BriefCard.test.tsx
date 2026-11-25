import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type { SessionHistoryBriefDto } from '@invimport/contracts'
import { ServerStateProvider } from '#/components/query/ServerStateProvider'
import { createServerQueryClient } from '#/queries/client'
import { serverQueryKey, type ServerScope } from '#/queries/scope'
import { deferred } from '#/test/deferred'
import { H, briefRef, historyBrief } from '#/test/session-history'
import { BriefCard, type BriefLoader } from './BriefCard'

const scope: ServerScope = {
  origin: 'http://127.0.0.1:4310',
  actorId: 'd0000000-0000-4000-8000-00000000000d',
  targetId: 'e0000000-0000-4000-8000-00000000000e',
  targetContextId: 'f0000000-0000-4000-8000-00000000000f',
}
const context = { batchId: H.batch, jobId: H.job, step: 'research' as const }

function mount(load: BriefLoader) {
  const cache = createServerQueryClient()
  render(
    <ServerStateProvider scope={scope} client={cache}>
      <BriefCard reference={briefRef()} context={context} load={load} />
    </ServerStateProvider>,
  )
  const card = screen.getByRole('group', { name: /^Brief at start/ })
  const summary = card.querySelector('summary')!

  return { cache, card, summary }
}

test('live updates neither cancel nor read an opened brief again', async () => {
  const user = userEvent.setup()
  const load = vi.fn<BriefLoader>().mockResolvedValue(historyBrief())
  const { cache, card, summary } = mount(load)
  await user.click(summary)
  await within(card).findByRole('heading', { name: 'Observations' })

  await act(() => cache.invalidateQueries({ queryKey: serverQueryKey(scope) }))
  expect(load).toHaveBeenCalledTimes(1)
})

test('opening it again reads it again, keeping the copy it has if that read fails', async () => {
  const user = userEvent.setup()
  const load = vi
    .fn<BriefLoader>()
    .mockResolvedValueOnce(historyBrief())
    .mockRejectedValue(new Error('down'))
  const { card, summary } = mount(load)
  await user.click(summary)
  await within(card).findByRole('heading', { name: 'Observations' })
  await user.click(summary)
  await user.click(summary)

  expect(
    await within(card).findByText('Couldn’t read this brief again; showing the copy read earlier.'),
  ).toBeVisible()
  expect(within(card).getByRole('heading', { name: 'Observations' })).toBeVisible()
  expect(load).toHaveBeenCalledTimes(2)
})

test('a slow retry keeps its button, and focus stays where the operator moved it', async () => {
  const user = userEvent.setup()
  const slow = deferred<SessionHistoryBriefDto>()
  const load = vi
    .fn<BriefLoader>()
    .mockRejectedValueOnce(new Error('down'))
    .mockReturnValueOnce(slow.promise)
  const { card, summary } = mount(load)
  await user.click(summary)
  const retry = await within(card).findByRole('button', { name: 'Try again' })

  retry.focus()
  await user.keyboard('{Enter}')
  expect(within(card).getByRole('button', { name: 'Trying again…' })).toHaveFocus()
  // The operator moves on before the read lands; it doesn't pull focus back.
  summary.focus()
  await act(async () => slow.resolve(historyBrief()))
  await within(card).findByRole('heading', { name: 'Observations' })
  expect(summary).toHaveFocus()
})
