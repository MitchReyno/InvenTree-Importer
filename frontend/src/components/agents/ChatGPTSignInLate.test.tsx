import { act, fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { deferred } from '#/test/deferred'
import { ChatGPTSignIn } from './ChatGPTSignIn'

// The dialog stands in for the runner flow: its button is the VM confirming the account.
vi.mock('./ChatGPTSignInDialog', () => ({
  ChatGPTSignInDialog: ({
    onConfirmed,
    onChanged,
    onClose,
  }: {
    onConfirmed: () => void
    onChanged: () => void
    onClose: () => void
  }) => (
    <div role="dialog" aria-label="ChatGPT sign-in">
      <button onClick={onConfirmed}>Account confirmed</button>
      <button onClick={onChanged}>Disconnect</button>
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

test('a newer change made in the dialog keeps it open over an older confirmation', async () => {
  const held = deferred<void>()
  const onChanged = vi.fn()
  render(<ChatGPTSignIn onConfirmed={() => held.promise} onChanged={onChanged} />)
  fireEvent.click(screen.getByRole('button', { name: 'Sign in to ChatGPT…' }))
  fireEvent.click(screen.getByRole('button', { name: 'Account confirmed' }))
  fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
  expect(onChanged).toHaveBeenCalledTimes(1)
  await act(async () => held.resolve())
  expect(screen.getByRole('dialog', { name: 'ChatGPT sign-in' })).toBeVisible()
})
