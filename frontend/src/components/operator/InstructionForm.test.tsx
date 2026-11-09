import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type { CaptureSnapshotDto, OperatorReviewDto } from '@invimport/contracts'
import type { OperatorReviewClient } from '#/operator/types'
import { render } from '#/test/render'
import { InstructionForm } from './InstructionForm'

const batch = { id: 'batch-1', revision: '4' } as CaptureSnapshotDto
const review = {
  instructions: [
    { group_id: 'group-1', text: 'Keep apart', version: 2, created_at: '2026-11-01T00:00:00Z' },
  ],
} as unknown as OperatorReviewDto

function renderForm(instruct: OperatorReviewClient['instruct'] = vi.fn(async () => review)) {
  const onDirtyChange = vi.fn()
  const reload = vi.fn(async () => undefined)
  const client = { instruct } as unknown as OperatorReviewClient
  const view = render(
    <InstructionForm
      batch={batch}
      review={review}
      client={client}
      groupId="group-1"
      label="Group “Reels”"
      disabled={false}
      reload={reload}
      onDirtyChange={onDirtyChange}
    />,
  )
  return { ...view, instruct, onDirtyChange, reload, field: screen.getByLabelText('Group “Reels”') }
}

test('editing the instructions reports unsaved work, and typing them back releases it', async () => {
  const user = userEvent.setup()
  const { field, onDirtyChange } = renderForm()
  expect(field).toHaveValue('Keep apart')
  await user.type(field, '!')
  expect(onDirtyChange).toHaveBeenLastCalledWith(true)
  await user.type(field, '{Backspace}')
  expect(onDirtyChange).toHaveBeenLastCalledWith(false)
})

test('a confirmed save sends the loaded revision, releases the guard and reloads', async () => {
  const user = userEvent.setup()
  const { field, instruct, onDirtyChange, reload } = renderForm()
  await user.clear(field)
  await user.type(field, 'Keep each reel apart')
  await user.click(screen.getByRole('button', { name: /save/i }))
  expect(instruct).toHaveBeenCalledWith(
    'batch-1',
    { expected_revision: '4', group_id: 'group-1', text: 'Keep each reel apart' },
    expect.any(String),
  )
  expect(onDirtyChange).toHaveBeenLastCalledWith(false)
  expect(reload).toHaveBeenCalledOnce()
})

test('removing the form while it holds edits releases the guard', async () => {
  const user = userEvent.setup()
  const { field, onDirtyChange, unmount } = renderForm()
  await user.type(field, '!')
  unmount()
  expect(onDirtyChange).toHaveBeenLastCalledWith(false)
})
