import { act, fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { deferred } from '#/test/deferred'
import { ChatGPTSignIn } from './ChatGPTSignIn'

// The dialog stands in for the runner flow: its button is the VM confirming the account.
vi.mock('./ChatGPTSignInDialog', () => ({
  ChatGPTSignInDialog: ({
    onConfirmed,
    onClose,
    settling,
    listNotMarked,
  }: {
    onConfirmed: () => void
    onClose: () => void
    settling: boolean
    listNotMarked: boolean
  }) => (
    <div role="dialog" aria-label="ChatGPT sign-in">
      {listNotMarked && <p>List may be out of date</p>}
      <button onClick={onConfirmed}>Account confirmed</button>
      <button disabled={settling}>Disconnect</button>
      <button onClick={onClose}>Close</button>
    </div>
  ),
}))

test('the dialog closes once a confirmation settles, but a late one never closes a reopened dialog', async () => {
  const first = deferred<void>()
  const second = deferred<void>()
  const onConfirmed = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
  render(<ChatGPTSignIn onConfirmed={onConfirmed} onChanged={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Sign in to ChatGPT…' }))
  fireEvent.click(screen.getByRole('button', { name: 'Account confirmed' }))
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  fireEvent.click(screen.getByRole('button', { name: 'Sign in to ChatGPT…' }))
  await act(async () => first.resolve())
  expect(screen.getByRole('dialog', { name: 'ChatGPT sign-in' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Account confirmed' }))
  expect(screen.getByRole('dialog', { name: 'ChatGPT sign-in' })).toBeVisible()
  await act(async () => second.resolve())
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('while a confirmation settles the dialog holds its account controls, then closes', async () => {
  const held = deferred<void>()
  render(<ChatGPTSignIn onConfirmed={() => held.promise} onChanged={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Sign in to ChatGPT…' }))
  fireEvent.click(screen.getByRole('button', { name: 'Account confirmed' }))
  expect(screen.getByRole('button', { name: 'Disconnect' })).toBeDisabled()
  await act(async () => held.resolve())
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('an older opening’s refusal never takes the warning from the dialog open now', async () => {
  const first = deferred<boolean>()
  const onConfirmed = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce(false)
  render(<ChatGPTSignIn onConfirmed={onConfirmed} onChanged={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Sign in to ChatGPT…' }))
  fireEvent.click(screen.getByRole('button', { name: 'Account confirmed' }))
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  fireEvent.click(screen.getByRole('button', { name: 'Sign in to ChatGPT…' }))
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Account confirmed' }))
  })
  expect(screen.getByText('List may be out of date')).toBeVisible()
  await act(async () => first.resolve(false))
  expect(screen.getByText('List may be out of date')).toBeVisible()
})
