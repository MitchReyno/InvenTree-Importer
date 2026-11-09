import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test } from 'vitest'
import { HelpButton } from './HelpButton'

const explanation =
  'Group photos that belong together, such as the front and back of one packet. Groups are hints.'

test('names what it explains and shows the explanation as a tooltip', () => {
  render(<HelpButton label="About groups" explanation={explanation} />)
  const help = screen.getByRole('button', { name: 'About groups' })

  expect(help).toHaveAttribute('title', explanation)
  expect(help).toHaveAttribute('aria-expanded', 'false')
})

test('opens the explanation beside it; Escape closes it and returns focus', async () => {
  const user = userEvent.setup()
  render(<HelpButton label="About groups" explanation={explanation} />)
  const help = screen.getByRole('button', { name: 'About groups' })
  await user.click(help)

  const panel = await screen.findByRole('dialog', { name: 'About groups' })
  expect(panel).toHaveTextContent(explanation)
  expect(help).toHaveAttribute('aria-expanded', 'true')
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(help).toHaveFocus()
})
