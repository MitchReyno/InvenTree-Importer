import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import App from './App'

test('source intake stays local and lets the user remove or clear selections', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch')
  const user = userEvent.setup()
  render(<App />)
  expect(screen.getByText('Intake scaffold')).toBeVisible()
  expect(screen.getByRole('status')).toHaveTextContent('0 files selected')
  const first = new File(['{}'], 'parts.json', { type: 'application/json' })
  const second = new File(['fake photo'], 'label.jpg', { type: 'image/jpeg' })
  await user.upload(screen.getByLabelText('Choose source files'), [first, second])
  const selected = screen.getByRole('list', { name: 'Selected source files' })
  expect(within(selected).getByText('parts.json')).toBeVisible()
  expect(within(selected).getByText('label.jpg')).toBeVisible()
  expect(screen.getByRole('status')).toHaveTextContent('2 files selected')
  await user.click(screen.getByRole('button', { name: 'Remove parts.json' }))
  expect(screen.queryByText('parts.json')).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('1 file selected')
  await user.click(screen.getByRole('button', { name: 'Clear selection' }))
  expect(screen.getByRole('status')).toHaveTextContent('0 files selected')
  expect(fetch).not.toHaveBeenCalled()
  fetch.mockRestore()
})

test('different source files with the same name are retained independently', async () => {
  const user = userEvent.setup()
  render(<App />)
  await user.upload(screen.getByLabelText('Choose source files'), [
    new File(['first'], 'receipt.csv', { type: 'text/csv' }),
    new File(['second'], 'receipt.csv', { type: 'text/csv' }),
  ])
  expect(screen.getAllByText('receipt.csv')).toHaveLength(2)
  expect(screen.getByRole('status')).toHaveTextContent('2 files selected')
})
