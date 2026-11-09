import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { IconButton } from './IconButton'
import { MenuIcon, SettingsIcon } from './icons'

test('a button names its icon in its label and title', async () => {
  const onClick = vi.fn()
  render(<IconButton label="Menu" icon={<MenuIcon />} onClick={onClick} />)
  const button = screen.getByRole('button', { name: 'Menu' })

  expect(button).toHaveAttribute('title', 'Menu')
  expect(button).toHaveAttribute('type', 'button')
  expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  await userEvent.click(button)
  expect(onClick).toHaveBeenCalledTimes(1)
})

test('it is a link when it navigates', () => {
  render(<IconButton label="Settings" icon={<SettingsIcon />} href="#settings" />)

  expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '#settings')
  expect(screen.queryByRole('button')).toBeNull()
})
