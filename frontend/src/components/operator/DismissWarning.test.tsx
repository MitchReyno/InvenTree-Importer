import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type { CaptureSnapshotDto, OperatorIssueDto } from '@invimport/contracts'
import type { OperatorReviewClient } from '#/operator/types'
import { render } from '#/test/render'
import { DismissWarning } from './DismissWarning'

const batch = { id: 'batch-1', revision: '7' } as CaptureSnapshotDto
const issue = {
  code: 'quantity_unknown',
  subject_id: 'lot-1',
  dependency_digest: 'd'.repeat(64),
} as OperatorIssueDto

function renderDismiss(dismiss: OperatorReviewClient['dismiss']) {
  const onDirtyChange = vi.fn()
  const onDismissed = vi.fn(async () => undefined)
  const client = { dismiss } as unknown as OperatorReviewClient
  const view = render(
    <DismissWarning
      batch={batch}
      issue={issue}
      client={client}
      disabled={false}
      onDismissed={onDismissed}
      onCancel={vi.fn()}
      onDirtyChange={onDirtyChange}
    />,
  )
  return {
    ...view,
    onDirtyChange,
    onDismissed,
    reason: screen.getByLabelText('Why is this acceptable?'),
  }
}

test('typing a reason reports unsaved work, and a confirmed dismissal releases it', async () => {
  const user = userEvent.setup()
  const dismiss = vi.fn(async () => ({}))
  const { reason, onDirtyChange, onDismissed } = renderDismiss(dismiss as never)
  await user.type(reason, '  Counted by hand  ')
  expect(onDirtyChange).toHaveBeenLastCalledWith(true)
  await user.click(screen.getByRole('button', { name: 'Dismiss with this reason' }))
  expect(dismiss).toHaveBeenCalledWith(
    'batch-1',
    expect.objectContaining({ expected_batch_revision: '7', reason: 'Counted by hand' }),
    expect.any(String),
  )
  expect(onDismissed).toHaveBeenCalledOnce()
  expect(onDirtyChange).toHaveBeenLastCalledWith(false)
})

test('an unconfirmed dismissal keeps the guard and retries with the same key', async () => {
  const user = userEvent.setup()
  const dismiss = vi.fn().mockRejectedValueOnce(new Error('lost')).mockResolvedValueOnce({})
  const { reason, onDirtyChange, onDismissed } = renderDismiss(dismiss)
  await user.type(reason, 'Counted by hand')
  await user.click(screen.getByRole('button', { name: 'Dismiss with this reason' }))
  expect(await screen.findByText(/The outcome is not confirmed/)).toBeVisible()
  expect(onDirtyChange).toHaveBeenLastCalledWith(true)
  await user.click(screen.getByRole('button', { name: 'Retry exact dismissal' }))
  expect(dismiss.mock.calls[1][2]).toBe(dismiss.mock.calls[0][2])
  expect(onDismissed).toHaveBeenCalledOnce()
  expect(onDirtyChange).toHaveBeenLastCalledWith(false)
})

test('a blank reason is refused before anything is sent', async () => {
  const user = userEvent.setup()
  const dismiss = vi.fn()
  renderDismiss(dismiss)
  await user.click(screen.getByRole('button', { name: 'Dismiss with this reason' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Give a reason before dismissing.')
  expect(dismiss).not.toHaveBeenCalled()
})

test('closing the form with a reason releases the guard', async () => {
  const user = userEvent.setup()
  const { reason, onDirtyChange, unmount } = renderDismiss(vi.fn())
  await user.type(reason, 'Counted')
  unmount()
  expect(onDirtyChange).toHaveBeenLastCalledWith(false)
})

test('clearing the reason again releases the guard', async () => {
  const user = userEvent.setup()
  const { reason, onDirtyChange } = renderDismiss(vi.fn())
  await user.type(reason, 'x')
  expect(onDirtyChange).toHaveBeenLastCalledWith(true)
  await user.clear(reason)
  expect(onDirtyChange).toHaveBeenLastCalledWith(false)
})
