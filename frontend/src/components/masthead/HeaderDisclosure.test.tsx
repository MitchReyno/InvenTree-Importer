import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test } from 'vitest'
import { HeaderDisclosureProof } from './fixtures/HeaderDisclosureProof'

test('controlled header disclosure exposes labelled content and returns focus on Escape', async () => {
  const user = userEvent.setup()
  render(<HeaderDisclosureProof />)
  const trigger = screen.getByRole('button', { name: 'Connection status' })
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await user.click(trigger)
  expect(await screen.findByRole('dialog', { name: 'Connection details' })).toBeVisible()
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(trigger).toHaveFocus()
})

test('switching disclosures keeps one open and preserves a neighbouring draft', async () => {
  const user = userEvent.setup()
  render(<HeaderDisclosureProof />)
  const draft = screen.getByRole('textbox', { name: 'Fixture draft' })
  fireEvent.change(draft, { target: { value: 'Preserve exact input Ω' } })
  await user.click(screen.getByRole('button', { name: 'Connection status' }))
  await user.click(screen.getByRole('button', { name: 'Workflow activity' }))
  expect(await screen.findByRole('dialog', { name: 'Workflow details' })).toBeVisible()
  expect(screen.queryByRole('dialog', { name: 'Connection details' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Close Workflow details' }))
  expect(draft).toHaveValue('Preserve exact input Ω')
})
