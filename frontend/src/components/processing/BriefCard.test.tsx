import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type { SessionHistoryBriefDto } from '@invimport/contracts'
import { ServerStateProvider } from '#/components/query/ServerStateProvider'
import { createServerQueryClient } from '#/queries/client'
import { serverQueryKey, type ServerScope } from '#/queries/scope'
import { deferred } from '#/test/deferred'
import { H, briefRef, historyBrief, researchBriefEntries } from '#/test/session-history'
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
      <button type="button">Elsewhere</button>
    </ServerStateProvider>,
  )
  const card = screen.getByRole('group', { name: /^Brief at start/ })
  const summary = card.querySelector('summary')!

  return { cache, card, summary }
}

test('live updates neither cancel nor read an opened brief again', async () => {
  const user = userEvent.setup()
  const read = deferred<SessionHistoryBriefDto>()
  const load = vi.fn<BriefLoader>().mockReturnValue(read.promise)
  const { cache, card, summary } = mount(load)
  await user.click(summary)
  expect(within(card).getByRole('status')).toHaveTextContent('Reading the brief…')

  // What a live hint does to the scope's reads, while the brief's read is in flight.
  await act(async () => {
    await cache.cancelQueries({ queryKey: serverQueryKey(scope) })
    await cache.invalidateQueries({ queryKey: serverQueryKey(scope) })
  })
  await act(async () => read.resolve(historyBrief()))
  await within(card).findByRole('heading', { name: 'Observations' })
  expect(load).toHaveBeenCalledTimes(1)
})

test('opening it again shows only what that opening reads, never the earlier copy', async () => {
  const user = userEvent.setup()
  const again = deferred<SessionHistoryBriefDto>()
  const load = vi
    .fn<BriefLoader>()
    .mockResolvedValueOnce(historyBrief())
    .mockReturnValueOnce(again.promise)
  const { card, summary } = mount(load)
  await user.click(summary)
  await within(card).findByRole('heading', { name: 'Observations' })
  await user.click(summary)
  await user.click(summary)

  // The photo behind the observations was removed meanwhile; the earlier copy isn't shown.
  expect(within(card).getByRole('status')).toHaveTextContent('Reading the brief…')
  expect(within(card).queryByRole('heading', { name: 'Observations' })).toBeNull()
  await act(async () => again.reject(new Error('down')))
  expect(await within(card).findByRole('alert')).toHaveTextContent(
    'The brief this attempt started from couldn’t be read.',
  )
  expect(within(card).queryByRole('heading', { name: 'Observations' })).toBeNull()
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
  // The operator moves on before the read lands; it doesn't pull focus to the brief.
  const elsewhere = screen.getByRole('button', { name: 'Elsewhere' })
  elsewhere.focus()
  await act(async () => slow.resolve(historyBrief()))
  await within(card).findByRole('heading', { name: 'Observations' })
  expect(elsewhere).toHaveFocus()
})

test('a read from an earlier opening, still in flight, never shows in a later one', async () => {
  const user = userEvent.setup()
  const first = deferred<SessionHistoryBriefDto>()
  const second = deferred<SessionHistoryBriefDto>()
  const load = vi
    .fn<BriefLoader>()
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise)
  const { card, summary } = mount(load)
  await user.click(summary)
  await user.click(summary)
  await user.click(summary)

  // The first opening's read lands late, with an observation since removed; it isn't shown.
  await act(async () => first.resolve(historyBrief()))
  expect(within(card).getByRole('status')).toHaveTextContent('Reading the brief…')
  expect(within(card).queryByRole('heading', { name: 'Observations' })).toBeNull()
  const withoutPhoto = historyBrief(
    researchBriefEntries().filter(
      (entry) => entry.kind !== 'observation' && entry.kind !== 'correction',
    ),
  )
  await act(async () => second.resolve(withoutPhoto))
  await within(card).findByRole('heading', { name: 'Your facts' })
  expect(within(card).queryByRole('heading', { name: 'Observations' })).toBeNull()
  expect(load).toHaveBeenCalledTimes(2)
})
