import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { render } from '#/test/render'
import { PauseButton } from './PauseButton'

test('is disabled while the change is unanswered and enabled once it settles', async () => {
  const user = userEvent.setup()
  let settle!: () => void
  const change = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        settle = resolve
      }),
  )
  render(<PauseButton paused={false} change={change} />)
  await user.click(screen.getByRole('button', { name: 'Pause all' }))
  expect(change).toHaveBeenCalledWith(true)
  expect(screen.getByRole('button', { name: 'Pause all' })).toBeDisabled()
  await act(async () => settle())
  expect(screen.getByRole('button', { name: 'Pause all' })).toBeEnabled()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

test('a resume that fails says the agents are still paused', async () => {
  const user = userEvent.setup()
  const change = vi.fn(async () => Promise.reject(new Error('offline')))
  render(<PauseButton paused change={change} />)
  await user.click(screen.getByRole('button', { name: 'Resume' }))
  expect(change).toHaveBeenCalledWith(false)
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Resuming failed; the agents are still paused.',
  )
  expect(screen.getByRole('button', { name: 'Resume' })).toBeEnabled()
})
