import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import type { CaptureSnapshotDto } from '@invimport/contracts'
import type { OperatorReviewClient } from '#/operator/types'
import { RestructureDialog } from './RestructureDialog'

const observation = (id: string, marking: string) => ({
  id,
  readings: { markings: [marking] },
  lot_id: 'l1',
  status: 'active',
})

const batch = {
  id: 'b',
  revision: '7',
  lots: [{ id: 'l1', label: 'Reels', evidence_observation_ids: ['o1', 'o2'], retired: false }],
  parts: [],
  evidence_observations: [observation('o1', 'Reel'), observation('o2', 'Reel')],
} as unknown as CaptureSnapshotDto

it('keeps each observation with the new lot shown after another is removed', async () => {
  const user = userEvent.setup()
  const restructure = vi.fn().mockRejectedValue(new Error('preview only'))
  render(
    <RestructureDialog
      kind="split"
      batch={batch}
      lotIds={['l1']}
      excludedLotIds={[]}
      client={{ restructure } as unknown as OperatorReviewClient}
      disabled={false}
      reload={vi.fn()}
      onClose={vi.fn()}
    />,
  )
  await user.click(screen.getByRole('button', { name: 'Add another new lot' }))
  await user.type(screen.getByLabelText('New lot 3 label'), 'Third')
  for (const [index, label] of ['1', '2', '3'].entries()) {
    await user.type(screen.getByLabelText(`New lot ${label} quantity`), String(index + 1))
  }
  // Same markings, distinct names.
  await user.selectOptions(screen.getByLabelText('Observation: Reel'), 'New lot 2: Reels · 2')
  await user.selectOptions(screen.getByLabelText('Observation: Reel (2)'), 'New lot 3: Third')
  await user.click(screen.getByRole('button', { name: 'Remove new lot 1' }))
  expect(screen.getByLabelText('Observation: Reel')).toHaveDisplayValue('New lot 1: Reels · 2')
  expect(screen.getByLabelText('Observation: Reel (2)')).toHaveDisplayValue('New lot 2: Third')
  await user.click(screen.getByRole('button', { name: 'Preview impact' }))
  await waitFor(() => expect(restructure).toHaveBeenCalledTimes(1))
  expect(restructure.mock.calls[0][1].change).toEqual({
    kind: 'split_lot',
    lot_id: 'l1',
    children: [
      { label: 'Reels · 2', quantity: '2', observation_ids: ['o1'] },
      { label: 'Third', quantity: '3', observation_ids: ['o2'] },
    ],
  })
})
