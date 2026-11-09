import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { NumberStepper } from './NumberStepper'

test('steps by one within its range and announces the value', async () => {
  const onChange = vi.fn()
  render(<NumberStepper label="Sessions at once" value={3} min={1} max={8} onChange={onChange} />)
  const group = screen.getByRole('group', { name: 'Sessions at once' })

  expect(group).toHaveTextContent('1 to 8')
  expect(screen.getByRole('status')).toHaveTextContent('3')
  await userEvent.click(screen.getByRole('button', { name: 'One more' }))
  expect(onChange).toHaveBeenLastCalledWith(4)
  await userEvent.click(screen.getByRole('button', { name: 'One fewer' }))
  expect(onChange).toHaveBeenLastCalledWith(2)
})

test.each([
  ['the maximum', 8, 'One more', 'One fewer'],
  ['the minimum', 1, 'One fewer', 'One more'],
])('disables the button at %s', async (_limit, value, blocked, open) => {
  const onChange = vi.fn()
  render(
    <NumberStepper label="Sessions at once" value={value} min={1} max={8} onChange={onChange} />,
  )

  expect(screen.getByRole('button', { name: blocked })).toHaveAttribute('aria-disabled', 'true')
  expect(screen.getByRole('button', { name: open })).not.toHaveAttribute('aria-disabled')
  await userEvent.click(screen.getByRole('button', { name: blocked }))
  expect(onChange).not.toHaveBeenCalled()
})

test('reaching a limit keeps focus on the button, which then does nothing', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  const { rerender } = render(
    <NumberStepper label="Sessions at once" value={7} min={1} max={8} onChange={onChange} />,
  )
  const more = screen.getByRole('button', { name: 'One more' })
  more.focus()
  await user.keyboard('{Enter}')
  expect(onChange).toHaveBeenCalledWith(8)

  rerender(<NumberStepper label="Sessions at once" value={8} min={1} max={8} onChange={onChange} />)
  expect(more).not.toBeDisabled()
  expect(more).toHaveAttribute('aria-disabled', 'true')
  expect(more).toHaveFocus()
  await user.keyboard('{Enter}')
  expect(onChange).toHaveBeenCalledTimes(1)
})
