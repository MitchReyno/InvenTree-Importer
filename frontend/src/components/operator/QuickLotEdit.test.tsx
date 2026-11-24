import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { searchAndPick } from '#/test/picker'
import { expect, test, vi } from 'vitest'
import type { CaptureSnapshotDto } from '@invimport/contracts'
import { render } from '#/test/render'
import { QuickLotEdit } from './QuickLotEdit'

type Lot = CaptureSnapshotDto['lots'][number]

const lot = {
  id: 'lot-1',
  label: 'Packet A',
  quantity: { mode: 'set', value: '5' },
  location: { mode: 'inherit' },
} as Lot
const batch = { id: 'batch-1', observations: [], lots: [lot] } as unknown as CaptureSnapshotDto

function renderEdit(edit = vi.fn(async () => true)) {
  const onDirtyChange = vi.fn()
  const view = render(
    <QuickLotEdit
      batch={batch}
      lot={lot}
      disabled={false}
      edit={edit}
      onDirtyChange={onDirtyChange}
    />,
  )
  return { ...view, edit, onDirtyChange, quantity: screen.getByLabelText('Exact pieces') }
}

test('editing the quantity reports unsaved work, and typing it back releases it', async () => {
  const user = userEvent.setup()
  const { quantity, onDirtyChange } = renderEdit()
  await user.type(quantity, '0')
  expect(onDirtyChange).toHaveBeenLastCalledWith(true, [
    { label: 'Packet A · quantity', discard: expect.any(Function) },
  ])
  await user.type(quantity, '{Backspace}')
  expect(quantity).toHaveValue('5')
  expect(onDirtyChange).toHaveBeenLastCalledWith(false)
})

test('a save sends only the fields that changed', async () => {
  const user = userEvent.setup()
  const { quantity, edit, onDirtyChange } = renderEdit()
  await user.clear(quantity)
  await user.type(quantity, '12')
  await user.click(screen.getByRole('button', { name: /save/i }))
  expect(edit).toHaveBeenCalledWith({
    kind: 'lot',
    id: 'lot-1',
    quantity: { mode: 'set', value: '12' },
  })
  expect(onDirtyChange).toHaveBeenLastCalledWith(false)
})

test('a refused save keeps the edits and the guard', async () => {
  const user = userEvent.setup()
  const { quantity, onDirtyChange } = renderEdit(vi.fn(async () => false))
  await user.clear(quantity)
  await user.type(quantity, '12')
  await user.click(screen.getByRole('button', { name: /save/i }))
  expect(quantity).toHaveValue('12')
  expect(onDirtyChange).toHaveBeenLastCalledWith(true, [
    { label: 'Packet A · quantity', discard: expect.any(Function) },
  ])
})

test('an invalid quantity is refused before anything is sent', async () => {
  const user = userEvent.setup()
  const { quantity, edit } = renderEdit()
  await user.clear(quantity)
  await user.type(quantity, '0')
  await user.click(screen.getByRole('button', { name: /save/i }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Enter an exact positive quantity.')
  expect(edit).not.toHaveBeenCalled()
})

test('closing the editor with changes releases the guard', async () => {
  const user = userEvent.setup()
  const { quantity, onDirtyChange, unmount } = renderEdit()
  await user.type(quantity, '0')
  unmount()
  expect(onDirtyChange).toHaveBeenLastCalledWith(false)
})

test('a location is searched among the observed ones and saved alone', async () => {
  const user = userEvent.setup()
  const drawer = {
    id: 'obs-1',
    model: 'location',
    pk: '43',
    label: 'Drawer 4',
    target_context_id: 'ctx',
  }
  const edit = vi.fn(async () => true)
  const onDirtyChange = vi.fn()
  render(
    <QuickLotEdit
      batch={{ ...batch, observations: [drawer] } as unknown as CaptureSnapshotDto}
      lot={lot}
      disabled={false}
      edit={edit}
      onDirtyChange={onDirtyChange}
    />,
  )
  await searchAndPick(user, 'Location', 'draw', 'Drawer 4 (#43)')
  expect(onDirtyChange).toHaveBeenLastCalledWith(true, [
    { label: 'Packet A · location', discard: expect.any(Function) },
  ])
  await user.click(screen.getByRole('button', { name: /save/i }))
  expect(edit).toHaveBeenCalledWith({
    kind: 'lot',
    id: 'lot-1',
    location: {
      mode: 'set',
      value: { observation_id: 'obs-1', target_context_id: 'ctx', model: 'location', pk: '43' },
    },
  })
})

test('the Location field says how to offer another location', () => {
  renderEdit()

  expect(
    screen.getByText('Affects only this lot. Read another location in Capture to add it here.'),
  ).toBeVisible()
})

test('a save in flight is not offered to the batch notice’s Discard, and its values stay', async () => {
  const user = userEvent.setup()

  let answer: (value: false) => void = () => undefined

  const edit = vi.fn(
    () =>
      new Promise<false>((resolve) => {
        answer = resolve
      }),
  )
  const { quantity, onDirtyChange } = renderEdit(edit)
  await user.clear(quantity)
  await user.type(quantity, '12')
  const [, named] = onDirtyChange.mock.lastCall as [boolean, { discard: () => void }[]]
  await user.click(screen.getByRole('button', { name: /save/i }))
  expect(onDirtyChange).toHaveBeenLastCalledWith(true)

  // The notice's Discard, pressed while the save is unanswered, changes nothing.
  act(() => named[0].discard())
  expect(quantity).toHaveValue('12')

  await act(async () => answer(false))
  expect(quantity).toHaveValue('12')
  expect(onDirtyChange).toHaveBeenLastCalledWith(true, [
    { label: 'Packet A · quantity', discard: expect.any(Function) },
  ])
})
