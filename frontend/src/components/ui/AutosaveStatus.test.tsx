import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { AutosaveStatus } from './AutosaveStatus'

test.each([
  ['saved', 'Saved'],
  ['pending', 'Unsaved changes · saving shortly'],
  ['saving', 'Saving…'],
  ['invalid', 'Not saved · fix the highlighted fields'],
  ['rejected', 'Not saved · the server refused these values. Change them to try again.'],
  ['disconnected', 'Not saved · connection unavailable; edits stay on this page'],
] as const)('%s is announced as text', (state, text) => {
  render(<AutosaveStatus label="Settings" state={state} revision="4" />)
  expect(screen.getByRole('status')).toHaveTextContent(`Settings: ${text}`)
})

test('the saved revision stays available without showing it inline', () => {
  render(<AutosaveStatus label="Settings" state="saved" revision="4" />)
  expect(screen.getByRole('status')).toHaveTextContent('Settings: Saved')
  expect(screen.getByRole('status')).not.toHaveTextContent('4')
  expect(screen.getByRole('status')).toHaveAttribute('data-revision', '4')
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

test('an unconfirmed save offers only the exact retry or an explicit discard', async () => {
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
  await user.click(screen.getByRole('button', { name: 'Discard my edits and load saved values' }))
  expect(reload).toHaveBeenCalledOnce()
})
