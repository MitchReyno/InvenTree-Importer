import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
  const select = screen.getByLabelText('Move Reel to')
  expect(screen.queryByRole('option', { name: 'Old' })).not.toBeInTheDocument()
  expect(screen.queryByRole('option', { name: 'Red LEDs' })).not.toBeInTheDocument()
  await userEvent.selectOptions(select, 'Green LEDs')
  await userEvent.click(screen.getByRole('button', { name: 'Move' }))
  expect(edit).toHaveBeenCalledWith({
    kind: 'observation_move',
    observation_id: 'o1',
    lot_id: 'l2',
  })
  await userEvent.selectOptions(select, 'No lot')
  await userEvent.click(screen.getByRole('button', { name: 'Move' }))
  expect(edit).toHaveBeenLastCalledWith({
    kind: 'observation_move',
    observation_id: 'o1',
    lot_id: null,
  })
})

it('a split sends each observation with the new lot chosen for it', () => {
  const values = {
    children: [
      { label: 'A1', quantity: '1' },
      { label: 'A2', quantity: '2' },
    ],
    observations: [
      { id: 'o1', child: '0' },
      { id: 'o2', child: '1' },
      // A new lot that was removed falls back to the first one.
      { id: 'o3', child: '5' },
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
