import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { listedOptions, pickOption, picker, searchAndPick } from '#/test/picker'
import { expect, it, vi } from 'vitest'
import type { CaptureSnapshotDto } from '@invimport/contracts'
import { ObservationMove } from './ObservationMove'
import { restructureChange } from './RestructureDialog'

const batch = {
  id: 'b',
  lots: [
    { id: 'l1', label: 'Red LEDs' },
    { id: 'l2', label: 'Green LEDs' },
    { id: 'l3', label: 'Old', retired: true },
  ],
} as unknown as CaptureSnapshotDto

it('moves an observation to another live lot or out of any lot', async () => {
  const user = userEvent.setup()
  const edit = vi.fn().mockResolvedValue(true)
  render(
    <ObservationMove
      batch={batch}
      observationId="o1"
      lotId="l1"
      name="Reel"
      edit={edit}
      disabled={false}
    />,
  )
  await user.click(picker('Move Reel to'))
  expect(listedOptions()).toEqual(['Not chosen', 'Green LEDs', 'No lot'])
  await user.keyboard('{Escape}')
  await searchAndPick(user, 'Move Reel to', 'green', 'Green LEDs')
  await user.click(screen.getByRole('button', { name: 'Move' }))
  expect(edit).toHaveBeenCalledWith({
    kind: 'observation_move',
    observation_id: 'o1',
    lot_id: 'l2',
  })
  await pickOption(user, 'Move Reel to', 'No lot')
  await user.click(screen.getByRole('button', { name: 'Move' }))
  expect(edit).toHaveBeenLastCalledWith({
    kind: 'observation_move',
    observation_id: 'o1',
    lot_id: null,
  })
})

it('a split sends each observation with the new lot chosen for it', () => {
  const values = {
    children: [
      { key: 'k1', label: 'A1', quantity: '1' },
      { key: 'k2', label: 'A2', quantity: '2' },
    ],
    observations: [
      { id: 'o1', child: 'k1' },
      { id: 'o2', child: 'k2' },
      // A new lot that was removed falls back to the first one.
      { id: 'o3', child: 'gone' },
    ],
    label: '',
    quantity: '',
    partId: '',
    confirmed: false,
    destination: 'existing' as const,
    destinationPartId: '',
    newPartLabel: '',
  }
  expect(restructureChange('split', ['a'], values)).toEqual({
    kind: 'split_lot',
    lot_id: 'a',
    children: [
      { label: 'A1', quantity: '1', observation_ids: ['o1', 'o3'] },
      { label: 'A2', quantity: '2', observation_ids: ['o2'] },
    ],
  })
})
