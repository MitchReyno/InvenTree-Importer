import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type { CaptureSnapshotDto } from '@invimport/contracts'
import { render } from '#/test/render'
import { ExcludeForm } from './ExcludeLot'

const lot = {
  id: '30000000-0000-4000-8000-000000000003',
  label: 'Packet A',
} as CaptureSnapshotDto['lots'][number]

function renderForm(edit = vi.fn(async () => true)) {
  const onDirtyChange = vi.fn()
  const onDone = vi.fn()
  const view = render(
    <ExcludeForm
      lot={lot}
      disabled={false}
      edit={edit}
      onDone={onDone}
      onDirtyChange={onDirtyChange}
    />,
  )
  return {
    ...view,
    edit,
    onDirtyChange,
    onDone,
    input: screen.getByLabelText('Why leave Packet A out?'),
  }
}

test('typing a reason reports dirty from the input event, and clearing it reports clean', () => {
  const { input, onDirtyChange } = renderForm()
  fireEvent.change(input, { target: { value: 'Damaged' } })
  expect(onDirtyChange).toHaveBeenLastCalledWith(true)
  fireEvent.change(input, { target: { value: '' } })
  expect(onDirtyChange).toHaveBeenLastCalledWith(false)
})

test('a confirmed exclusion sends the trimmed reason, clears the draft and finishes', async () => {
  const { input, edit, onDirtyChange, onDone } = renderForm()
  const user = userEvent.setup()
  await user.type(input, '  Damaged  ')
  await user.click(screen.getByRole('button', { name: 'Exclude this lot' }))
  expect(edit).toHaveBeenCalledWith({ kind: 'lot_exclusion', lot_id: lot.id, reason: 'Damaged' })
  expect(onDone).toHaveBeenCalledOnce()
  expect(onDirtyChange).toHaveBeenLastCalledWith(false)
})

test('a refused exclusion keeps the reason and the guard', async () => {
  const { input, onDirtyChange, onDone } = renderForm(vi.fn(async () => false))
  const user = userEvent.setup()
  await user.type(input, 'Damaged')
  await user.click(screen.getByRole('button', { name: 'Exclude this lot' }))
  expect(onDone).not.toHaveBeenCalled()
  expect(input).toHaveValue('Damaged')
  expect(onDirtyChange).toHaveBeenLastCalledWith(true)
})

test('unmounting with a reason releases the guard', () => {
  const { input, onDirtyChange, unmount } = renderForm()
  fireEvent.change(input, { target: { value: 'Damaged' } })
  unmount()
  expect(onDirtyChange).toHaveBeenLastCalledWith(false)
})
