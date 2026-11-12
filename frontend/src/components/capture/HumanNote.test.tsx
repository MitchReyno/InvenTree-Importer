import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test } from 'vitest'
import type { Snapshot } from '#/capture/types'
import { fixtureScope, render } from '#/test/render'
import { HumanNote } from './HumanNote'

const batch: Snapshot = {
  id: '10000000-0000-4000-8000-000000000001',
  source_id: '20000000-0000-4000-8000-000000000002',
  actor_id: fixtureScope.actorId,
  target_context_id: fixtureScope.targetContextId,
  title: 'Notes',
  revision: '3',
  archived: false,
  updated_at: '2026-11-03T00:00:00Z',
  defaults: { quantity: { mode: 'unknown' }, location: { mode: 'unset' } },
  lots: [],
  parts: [],
  notes: [
    {
      id: '30000000-0000-4000-8000-000000000003',
      subject_id: null,
      text: 'Two reels came loose.',
      actor_id: fixtureScope.actorId,
      created_at: '2026-11-03T00:00:00Z',
      producer: 'human',
    },
  ],
  observations: [],
  cursor: { stream_id: '40000000-0000-4000-8000-000000000004', sequence: '0' },
}

test('a written note offers Delete disabled, saying deleting notes comes later', async () => {
  const user = userEvent.setup()
  render(<HumanNote note={batch.notes[0]} batch={batch} />)
  await user.click(screen.getByRole('button', { name: /^Actions for the Batch note of .+/ }))
  const remove = await screen.findByRole('menuitem', { name: 'Delete…' })

  expect(remove).toHaveAttribute('aria-disabled', 'true')
  expect(remove).toHaveAccessibleDescription(/Deleting written notes comes later/)
  await user.click(remove)
  expect(screen.getByRole('menu')).toBeVisible()
})
