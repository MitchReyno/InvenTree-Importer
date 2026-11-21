import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type { CaptureSnapshotDto } from '@invimport/contracts'
import { render } from '#/test/render'
import { GroupLocationControl } from './GroupLocationControl'

vi.mock('#/components/capture/AssignedLocationField', () => ({
  AssignedLocationField: ({ onChange }: { onChange: (value: { mode: 'unset' }) => void }) => (
    <button type="button" onClick={() => onChange({ mode: 'unset' })}>
      Choose location
    </button>
  ),
}))

const batch = { id: 'b', group_locations: [] } as unknown as CaptureSnapshotDto

function renderControl(
  edit = vi.fn(async (): Promise<boolean> => false),
  reload = vi.fn(async () => undefined),
) {
  const onDirtyChange = vi.fn()
  const view = render(
    <GroupLocationControl
      batch={batch}
      groupId="g"
      name="Reels"
      disabled={false}
      edit={edit}
      reload={reload}
      onDirtyChange={onDirtyChange}
    />,
  )
  return { ...view, edit, reload, onDirtyChange }
}

test('a refused group location stays dirty and offers retry or discard', async () => {
  const user = userEvent.setup()
  const { edit, onDirtyChange } = renderControl()
  await user.click(screen.getByRole('button', { name: 'Choose location' }))
  expect(edit).toHaveBeenCalledWith({
    kind: 'group_location',
    group_id: 'g',
    location: { mode: 'unset' },
  })
  expect(await screen.findByText(/was not confirmed/)).toBeVisible()
  expect(onDirtyChange).toHaveBeenLastCalledWith(true)
  expect(screen.getByRole('button', { name: 'Discard group location change' })).toBeVisible()
})

test('a discard whose reload does not remount the control reports the reload as failed', async () => {
  const user = userEvent.setup()
  const { reload } = renderControl()
  await user.click(screen.getByRole('button', { name: 'Choose location' }))
  await user.click(await screen.findByRole('button', { name: 'Discard group location change' }))
  expect(reload).toHaveBeenCalledOnce()
  expect(
    await screen.findByText('Saved values could not be reloaded; the change is kept.'),
  ).toBeVisible()
})

test('a confirmed group location releases the guard', async () => {
  const user = userEvent.setup()
  const { onDirtyChange } = renderControl(vi.fn(async (): Promise<boolean> => true))
  await user.click(screen.getByRole('button', { name: 'Choose location' }))
  expect(onDirtyChange).toHaveBeenLastCalledWith(false)
})
