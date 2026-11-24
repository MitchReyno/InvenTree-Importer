import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { pickOption, searchAndPick } from '#/test/picker'
import { expect, it, vi } from 'vitest'
import type { CaptureSnapshotDto } from '@invimport/contracts'
import { IntakeRequestError } from '@invimport/contracts/client'
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

it('reports a draft from typing and rows, and is clean again once it matches the opening values', async () => {
  const user = userEvent.setup()
  const onDirtyChange = vi.fn()
  render(
    <RestructureDialog
      kind="split"
      batch={batch}
      lotIds={['l1']}
      excludedLotIds={[]}
      client={{ restructure: vi.fn() } as unknown as OperatorReviewClient}
      disabled={false}
      reload={vi.fn()}
      onClose={vi.fn()}
      onDirtyChange={onDirtyChange}
    />,
  )
  const label = screen.getByLabelText('New lot 1 label')
  await user.type(label, '!')
  expect(onDirtyChange).toHaveBeenLastCalledWith(true)
  await user.type(label, '{Backspace}')
  expect(onDirtyChange).toHaveBeenLastCalledWith(false)
  await user.click(screen.getByRole('button', { name: 'Add another new lot' }))
  expect(onDirtyChange).toHaveBeenLastCalledWith(true)
  await user.click(screen.getByRole('button', { name: 'Remove new lot 3' }))
  expect(onDirtyChange).toHaveBeenLastCalledWith(false)
})

it('a refused apply of an unedited move leaves the guard released', async () => {
  const user = userEvent.setup()
  const onDirtyChange = vi.fn()
  const impact = {
    invalidated_review_subject_ids: [],
    affected_lot_ids: ['l1'],
    affected_part_ids: [],
    stale_preparation_ids: [],
    retired_lot_ids: [],
    created_lots: [],
    created_part: null,
  }
  const restructure = vi
    .fn()
    .mockResolvedValueOnce({ status: 'previewed', revision: '7', impact })
    .mockRejectedValueOnce(new IntakeRequestError(422, 'lot_already_approved'))
  render(
    <RestructureDialog
      kind="move"
      batch={
        { ...batch, parts: [{ id: 'p1', label: 'Resistor' }] } as unknown as CaptureSnapshotDto
      }
      lotIds={['l1']}
      excludedLotIds={[]}
      client={{ restructure } as unknown as OperatorReviewClient}
      disabled={false}
      reload={vi.fn()}
      onClose={vi.fn()}
      onDirtyChange={onDirtyChange}
    />,
  )
  await user.click(screen.getByRole('button', { name: 'Preview impact' }))
  await user.click(
    await screen.findByRole('button', { name: 'Apply move lots to a part proposal' }),
  )
  await waitFor(() => expect(restructure).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false))
})

it('states what splitting and merging keep in the dialog itself, with no help popover', () => {
  const twoLots = {
    ...batch,
    lots: [
      ...batch.lots,
      { id: 'l2', label: 'Tubes', evidence_observation_ids: [], retired: false },
    ],
  } as unknown as CaptureSnapshotDto
  const props = {
    excludedLotIds: [],
    client: { restructure: vi.fn() } as unknown as OperatorReviewClient,
    disabled: false,
    reload: vi.fn(),
    onClose: vi.fn(),
  }
  const { unmount } = render(
    <RestructureDialog kind="split" batch={twoLots} lotIds={['l1']} {...props} />,
  )

  expect(screen.getByText(/Each new lot keeps the Part proposal and location choice/)).toBeVisible()
  expect(screen.queryByRole('button', { name: /^About/ })).not.toBeInTheDocument()
  unmount()
  render(<RestructureDialog kind="merge" batch={twoLots} lotIds={['l1', 'l2']} {...props} />)
  expect(
    screen.getByText(/the merged lot uses the batch default until you choose one/),
  ).toBeVisible()
  expect(screen.queryByRole('button', { name: /^About/ })).not.toBeInTheDocument()
})

const twoParts = {
  ...batch,
  parts: [
    { id: 'p1', label: 'Resistor' },
    { id: 'p2', label: 'Capacitor' },
  ],
} as unknown as CaptureSnapshotDto

function previewOnly() {
  return vi.fn().mockResolvedValue({
    status: 'previewed',
    revision: '7',
    impact: {
      invalidated_review_subject_ids: [],
      affected_lot_ids: ['l1'],
      affected_part_ids: [],
      stale_preparation_ids: [],
      retired_lot_ids: [],
      created_lots: [],
      created_part: null,
    },
  })
}

it('a move chooses its destination from a segmented control and searches its Part proposal', async () => {
  const user = userEvent.setup()
  const restructure = previewOnly()
  const onDirtyChange = vi.fn()
  render(
    <RestructureDialog
      kind="move"
      batch={twoParts}
      lotIds={['l1']}
      excludedLotIds={[]}
      client={{ restructure } as unknown as OperatorReviewClient}
      disabled={false}
      reload={vi.fn()}
      onClose={vi.fn()}
      onDirtyChange={onDirtyChange}
    />,
  )
  const destination = screen.getByRole('group', { name: 'Destination' })
  expect(destination).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'New' }))
  expect(screen.getByLabelText('New Part proposal label')).toBeVisible()
  expect(onDirtyChange).toHaveBeenLastCalledWith(true)
  await user.click(screen.getByRole('button', { name: 'Existing' }))
  await searchAndPick(user, 'Part proposal', 'cap', 'Capacitor')
  await user.click(screen.getByRole('button', { name: 'Preview impact' }))
  await waitFor(() => expect(restructure).toHaveBeenCalledTimes(1))
  expect(restructure.mock.calls[0][1].change).toEqual({
    kind: 'move_lots',
    lot_ids: ['l1'],
    destination: { kind: 'existing', part_subject_id: 'p2' },
  })
})

it('a merge can leave out the Part proposal', async () => {
  const user = userEvent.setup()
  const restructure = previewOnly()
  render(
    <RestructureDialog
      kind="merge"
      batch={
        {
          ...twoParts,
          lots: [
            { ...batch.lots[0], part_subject_id: 'p1' },
            { id: 'l2', label: 'Tubes', evidence_observation_ids: [], retired: false },
          ],
        } as unknown as CaptureSnapshotDto
      }
      lotIds={['l1', 'l2']}
      excludedLotIds={[]}
      client={{ restructure } as unknown as OperatorReviewClient}
      disabled={false}
      reload={vi.fn()}
      onClose={vi.fn()}
    />,
  )
  await user.type(screen.getByLabelText('Merged lot quantity'), '4')
  await pickOption(user, 'Part proposal', 'No Part proposal')
  await user.click(
    screen.getByRole('checkbox', {
      name: 'These are one physical contribution, not just the same Part',
    }),
  )
  await user.click(screen.getByRole('button', { name: 'Preview impact' }))
  await waitFor(() => expect(restructure).toHaveBeenCalledTimes(1))
  expect(restructure.mock.calls[0][1].change).toMatchObject({
    kind: 'merge_lots',
    part_subject_id: null,
  })
})
