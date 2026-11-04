import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type { CaptureSnapshotDto } from '@invimport/contracts'
import { render } from '../../test/render'
import { CompareMatches } from './CompareMatches'

const part = {
  id: '20000000-0000-4000-8000-000000000002',
  label: 'Shared resistor',
  revision: '1',
  choice: { mode: 'unset' as const },
}
const batch = {
  id: '10000000-0000-4000-8000-000000000001',
  parts: [part],
  lots: [],
  notes: [],
  observations: [],
  defaults: { quantity: { mode: 'unset' }, location: { mode: 'unset' } },
} as unknown as CaptureSnapshotDto

test('with no observed Part candidates, the dialog hands over to the shared Part editor', async () => {
  const onClose = vi.fn()
  const onEditPart = vi.fn()
  render(
    <CompareMatches
      batch={batch}
      part={part}
      affectedLotIds={[]}
      disabled={false}
      edit={vi.fn()}
      onClose={onClose}
      onEditPart={onEditPart}
    />,
  )
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'Read an existing Part in the shared Part editor' }))
  expect(onClose).toHaveBeenCalledOnce()
  expect(onEditPart).toHaveBeenCalledOnce()
})
