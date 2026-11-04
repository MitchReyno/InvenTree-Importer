import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { AutosaveStatus } from './AutosaveStatus'

test.each([
  ['saved', 'Saved · revision 4'],
  ['pending', 'Unsaved changes · saving shortly'],
  ['saving', 'Saving…'],
  ['invalid', 'Not saved · fix the highlighted fields'],
  ['disconnected', 'Not saved · connection unavailable; edits stay on this page'],
] as const)('%s is announced as text', (state, text) => {
  render(<AutosaveStatus label="Settings" state={state} revision="4" />)
  expect(screen.getByRole('status')).toHaveTextContent(`Settings: ${text}`)
})

test('a conflict offers explicit reload and keeps local edits', async () => {
  const user = userEvent.setup()
  const reload = vi.fn()
  render(<AutosaveStatus label="Settings" state="conflict" revision="4" onReload={reload} />)
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Settings: Not saved · another change was saved first. Your edits are kept here.',
  )
  await user.click(screen.getByRole('button', { name: 'Discard my edits and load saved values' }))
  expect(reload).toHaveBeenCalledOnce()
})

test('an unconfirmed save offers the exact retry and reconciliation only', async () => {
  const user = userEvent.setup()
  const retry = vi.fn()
  const reload = vi.fn()
  render(
    <AutosaveStatus
      label="Settings"
      state="unconfirmed"
      revision="4"
      onRetry={retry}
      onReload={reload}
    />,
  )
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Settings: Save not confirmed · it may or may not have been applied.',
  )
  await user.click(screen.getByRole('button', { name: 'Retry the same save' }))
  expect(retry).toHaveBeenCalledOnce()
  await user.click(screen.getByRole('button', { name: 'Check saved values' }))
  expect(reload).toHaveBeenCalledOnce()
})
