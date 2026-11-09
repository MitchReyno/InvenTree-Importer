import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { Switch } from './Switch'

test('a labelled switch turns on and off from click and Space', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  const { rerender } = render(
    <Switch label="Allow public web pages" checked={false} onChange={onChange} />,
  )
  const control = screen.getByRole('switch', { name: 'Allow public web pages' })

  expect(control).not.toBeChecked()
  await user.click(screen.getByText('Allow public web pages'))
  expect(onChange).toHaveBeenLastCalledWith(true)

  rerender(<Switch label="Allow public web pages" checked onChange={onChange} />)
  expect(control).toBeChecked()
  control.focus()
  await user.keyboard(' ')
  expect(onChange).toHaveBeenLastCalledWith(false)
})

test('a disabled switch does not change', async () => {
  const onChange = vi.fn()
  render(<Switch label="Create purchase orders" checked={false} onChange={onChange} disabled />)

  await userEvent.click(screen.getByRole('switch', { name: 'Create purchase orders' }))
  expect(onChange).not.toHaveBeenCalled()
})
