import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type { CaptureSnapshotDto, OperatorImpactDto } from '@invimport/contracts'
import type { OperatorReviewClient } from '#/operator/types'
import { render } from '#/test/render'
import { BulkEditPanel } from './BulkEditPanel'

const lots = [
  { id: 'lot-a', label: 'Packet A' },
  { id: 'lot-b', label: 'Packet B' },
]
const batch = {
  id: 'batch-1',
  revision: '11',
  lots,
  parts: [],
  observations: [],
} as unknown as CaptureSnapshotDto
const impact: OperatorImpactDto = {
  invalidated_review_subject_ids: [],
  affected_lot_ids: ['lot-a', 'lot-b'],
  affected_part_ids: [],
  stale_preparation_ids: [],
  retired_lot_ids: [],
  created_lots: [],
  created_part: null,
}
const previewed = { status: 'previewed', revision: '11', impact }

function renderPanel(bulkEdit: OperatorReviewClient['bulkEdit']) {
  const onDirtyChange = vi.fn()
  const reload = vi.fn(async () => undefined)
  const client = { bulkEdit } as unknown as OperatorReviewClient
  const view = render(
    <BulkEditPanel
      batch={batch}
      selectedIds={['lot-a', 'lot-b']}
      activeLotIds={['lot-a', 'lot-b']}
      client={client}
      disabled={false}
      reload={reload}
      onDirtyChange={onDirtyChange}
    />,
  )
  return { ...view, onDirtyChange, reload, quantity: screen.getByLabelText('Quantity') }
}

test('choosing a change reports unsaved work, and choosing Keep again releases it', async () => {
  const user = userEvent.setup()
  const { quantity, onDirtyChange } = renderPanel(vi.fn())
  await user.selectOptions(quantity, 'unknown')
  expect(onDirtyChange).toHaveBeenLastCalledWith(true)
  await user.selectOptions(quantity, 'keep')
  expect(onDirtyChange).toHaveBeenLastCalledWith(false)
})

test('a previewed bulk edit applies to the selected lots and releases the guard', async () => {
  const user = userEvent.setup()
  const bulkEdit = vi.fn().mockResolvedValueOnce(previewed).mockResolvedValueOnce({})
  const { quantity, onDirtyChange, reload } = renderPanel(bulkEdit)
  await user.selectOptions(quantity, 'unknown')
  await user.click(screen.getByRole('button', { name: 'Preview bulk edit' }))
  await user.click(await screen.findByRole('button', { name: 'Apply to 2 lots' }))
  expect(bulkEdit).toHaveBeenLastCalledWith(
    'batch-1',
    expect.objectContaining({
      preview: false,
      lot_ids: ['lot-a', 'lot-b'],
      change: { quantity: { mode: 'unknown' } },
    }),
    expect.any(String),
  )
  expect(reload).toHaveBeenCalledOnce()
  expect(onDirtyChange).toHaveBeenLastCalledWith(false)
})

test('an exact retry after an unconfirmed apply releases the guard and keeps it released', async () => {
  const user = userEvent.setup()
  const bulkEdit = vi
    .fn()
    .mockResolvedValueOnce(previewed)
    .mockRejectedValueOnce(new Error('lost'))
    .mockResolvedValueOnce({})
  const { quantity, onDirtyChange } = renderPanel(bulkEdit)
  await user.selectOptions(quantity, 'unknown')
  await user.click(screen.getByRole('button', { name: 'Preview bulk edit' }))
  await user.click(await screen.findByRole('button', { name: 'Apply to 2 lots' }))
  await user.click(await screen.findByRole('button', { name: 'Retry exact bulk edit' }))
  expect(bulkEdit.mock.calls[2][2]).toBe(bulkEdit.mock.calls[1][2])
  await waitFor(() => expect(screen.queryByRole('button', { name: /Apply to/ })).toBeNull())
  expect(quantity).toHaveValue('keep')
  expect(onDirtyChange).toHaveBeenLastCalledWith(false)
})

test('closing the panel with changes releases the guard', async () => {
  const user = userEvent.setup()
  const { quantity, onDirtyChange, unmount } = renderPanel(vi.fn())
  await user.selectOptions(quantity, 'unknown')
  unmount()
  expect(onDirtyChange).toHaveBeenLastCalledWith(false)
})
