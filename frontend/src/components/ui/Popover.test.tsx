import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test } from 'vitest'
import { Popover } from './Popover'

test('opens a labelled popover from its trigger and returns focus on Escape', async () => {
  const user = userEvent.setup()
  render(
    <Popover label="Needs you" trigger={<button type="button">2 need you</button>}>
      <p>Is the loose bag 1N4148 diodes?</p>
    </Popover>,
  )
  const trigger = screen.getByRole('button', { name: '2 need you' })
  await user.click(trigger)

  expect(await screen.findByRole('dialog', { name: 'Needs you' })).toBeVisible()
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(trigger).toHaveFocus()
})

test('a panel can set its width, kept inside the window', async () => {
  const user = userEvent.setup()
  render(
    <Popover label="Options" width="220px" trigger={<button type="button">More</button>}>
      <p>Theme</p>
    </Popover>,
  )
  await user.click(screen.getByRole('button', { name: 'More' }))

  expect(await screen.findByRole('dialog', { name: 'Options' })).toHaveStyle({ width: '220px' })
})
