import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { ActionsMenu } from './ActionsMenu'

function renderMenu() {
  const open = vi.fn()
  const remove = vi.fn()
  render(
    <ActionsMenu
      label="Actions for Front label"
      items={[
        { label: 'Open', onSelect: open },
        { label: 'Move to group…', onSelect: vi.fn(), disabledReason: 'Drag it to a group.' },
        { label: 'Delete…', onSelect: remove },
      ]}
    />,
  )
  return { open, remove, trigger: screen.getByRole('button', { name: 'Actions for Front label' }) }
}

test('arrow keys move through the items, wrapping, and Escape returns focus to the trigger', async () => {
  const user = userEvent.setup()
  const { trigger } = renderMenu()
  trigger.focus()
  await user.keyboard('{ArrowDown}')

  const menu = await screen.findByRole('menu', { name: 'Actions for Front label' })
  expect(menu).toBeVisible()
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByRole('menuitem', { name: 'Open' })).toHaveFocus()
  await user.keyboard('{ArrowDown}')
  expect(screen.getByRole('menuitem', { name: 'Move to group…' })).toHaveFocus()
  await user.keyboard('{End}')
  expect(screen.getByRole('menuitem', { name: 'Delete…' })).toHaveFocus()
  await user.keyboard('{ArrowDown}')
  expect(screen.getByRole('menuitem', { name: 'Open' })).toHaveFocus()
  await user.keyboard('{ArrowUp}')
  expect(screen.getByRole('menuitem', { name: 'Delete…' })).toHaveFocus()
  await user.keyboard('{Home}')
  expect(screen.getByRole('menuitem', { name: 'Open' })).toHaveFocus()

  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
  expect(trigger).toHaveFocus()
})

test('Enter chooses an item, closes the menu and leaves focus on the trigger', async () => {
  const user = userEvent.setup()
  const { remove, trigger } = renderMenu()
  await user.click(trigger)
  await user.keyboard('{End}{Enter}')

  expect(remove).toHaveBeenCalledOnce()
  await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
  expect(trigger).toHaveFocus()
})

test('a disabled item stays focusable, says why and does nothing when chosen', async () => {
  const user = userEvent.setup()
  renderMenu()
  await user.click(screen.getByRole('button', { name: 'Actions for Front label' }))
  const move = await screen.findByRole('menuitem', { name: 'Move to group…' })

  expect(move).toHaveAttribute('aria-disabled', 'true')
  expect(move).toHaveAccessibleDescription('Drag it to a group.')
  await user.click(move)
  expect(screen.getByRole('menu')).toBeVisible()
})
