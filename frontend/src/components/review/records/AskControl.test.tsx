import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { render } from '#/test/render'
import { AskControl } from './AskControl'

let keys = 0

function renderAsk(send = vi.fn(async () => undefined), value: string | null = 'Resistor') {
  const report = vi.fn()
  const storeKey = `ask-test:${keys++}`
  const props = { step: 'Research', prefill: 'Please check.', storeKey, send, report }
  const view = render(<AskControl {...props} value={value} />)
  return { ...view, props, report, send }
}

test('opening the message reports unsaved work, and Cancel releases it', async () => {
  const user = userEvent.setup()
  const { report } = renderAsk()
  await user.click(screen.getByRole('button', { name: 'Ask Research' }))
  expect(report).toHaveBeenLastCalledWith(true)
  expect(screen.getByLabelText('Message to Research')).toHaveValue('Please check.')
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(report).toHaveBeenLastCalledWith(false)
  expect(screen.getByRole('button', { name: 'Ask Research' })).toBeVisible()
})

test('a confirmed send shows Asked and releases the guard until the value changes', async () => {
  const user = userEvent.setup()
  const { report, send, props, rerender } = renderAsk()
  await user.click(screen.getByRole('button', { name: 'Ask Research' }))
  await user.click(screen.getByRole('button', { name: 'Send to Research' }))
  expect(send).toHaveBeenCalledWith('Please check.', expect.any(String))
  expect(await screen.findByRole('status')).toHaveTextContent('Asked Research')
  expect(report).toHaveBeenLastCalledWith(false)
  rerender(<AskControl {...props} value="Resistor" />)
  expect(screen.getByRole('status')).toHaveTextContent('Asked Research')
  rerender(<AskControl {...props} value="Capacitor" />)
  expect(screen.getByRole('button', { name: 'Ask Research' })).toBeVisible()
  rerender(<AskControl {...props} value="Resistor" />)
  expect(screen.queryByRole('status')).toBeNull()
})

test('a send that is not confirmed keeps the message and the guard', async () => {
  const user = userEvent.setup()
  const { report } = renderAsk(vi.fn(async () => Promise.reject(new Error('lost'))))
  await user.click(screen.getByRole('button', { name: 'Ask Research' }))
  await user.click(screen.getByRole('button', { name: 'Send to Research' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Not confirmed')
  expect(screen.getByLabelText('Message to Research')).toBeVisible()
  expect(report).toHaveBeenLastCalledWith(true)
})

test('closing the record with an open message releases the guard', async () => {
  const user = userEvent.setup()
  const { report, unmount } = renderAsk()
  await user.click(screen.getByRole('button', { name: 'Ask Research' }))
  unmount()
  expect(report).toHaveBeenLastCalledWith(false)
})
