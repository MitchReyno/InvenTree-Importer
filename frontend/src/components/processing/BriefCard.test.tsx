import { render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { ServerStateProvider } from '#/components/query/ServerStateProvider'
import { createServerQueryClient } from '#/queries/client'
import type { ServerScope } from '#/queries/scope'
import { H, briefRef, historyBrief } from '#/test/session-history'
import { BriefCard } from './BriefCard'

const scope: ServerScope = {
  origin: 'http://127.0.0.1:4310',
  actorId: 'd0000000-0000-4000-8000-00000000000d',
  targetId: 'e0000000-0000-4000-8000-00000000000e',
  targetContextId: 'f0000000-0000-4000-8000-00000000000f',
}
const context = { batchId: H.batch, jobId: H.job, step: 'research' as const }

test('a brief read again on a later visit keeps the copy it has, and says the read failed', async () => {
  const load = vi.fn().mockResolvedValueOnce(historyBrief()).mockRejectedValue(new Error('down'))
  const cache = createServerQueryClient()

  const card = (shown: boolean) => (
    <ServerStateProvider scope={scope} client={cache}>
      {shown && <BriefCard reference={briefRef()} context={context} load={load} />}
    </ServerStateProvider>
  )

  const { rerender } = render(card(true))
  await screen.findByRole('group', { name: /Started from Examine’s findings/ })

  rerender(card(false))
  rerender(card(true))
  expect(
    await screen.findByText('Couldn’t read this brief again; showing the copy read earlier.'),
  ).toBeVisible()
  expect(screen.getByRole('group', { name: /Started from Examine’s findings/ })).toBeInTheDocument()
  expect(load).toHaveBeenCalledTimes(2)
  // A background read never moves focus.
  expect(document.activeElement).toBe(document.body)
})
