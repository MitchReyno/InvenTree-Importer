import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test } from 'vitest'
import { chooseAlign, Popover, roomFor } from './Popover'

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

test('a popover keeps its preferred alignment while that side has room', () => {
  const trigger = { left: 900, right: 1000 }

  expect(chooseAlign('end', trigger, 420, 1440)).toBe('end')
  expect(chooseAlign('start', { left: 100, right: 200 }, 420, 1440)).toBe('start')
  expect(chooseAlign('center', trigger, 420, 1440)).toBe('center')
})

test('a popover opens from the other edge of its trigger when the preferred side is too narrow', () => {
  // The batch header's need-you pill sits near the left edge: aligned to its end, the 420px
  // panel would be pushed against the window edge instead of opening at the pill.
  expect(chooseAlign('end', { left: 300, right: 400 }, 420, 1440)).toBe('start')
  expect(chooseAlign('start', { left: 1200, right: 1300 }, 420, 1440)).toBe('end')
})

test('a popover too wide for either side opens toward the side with more room', () => {
  expect(chooseAlign('end', { left: 100, right: 200 }, 380, 390)).toBe('start')
  expect(chooseAlign('start', { left: 250, right: 300 }, 380, 390)).toBe('end')
  expect(chooseAlign('end', { left: 250, right: 300 }, 380, 390)).toBe('end')
})

test('a panel is capped to the room on its chosen side, so it stays at its trigger', () => {
  expect(roomFor('start', { left: 145, right: 245 }, 390)).toBe(233)
  expect(roomFor('end', { left: 145, right: 245 }, 390)).toBe(233)
  expect(roomFor('end', { left: 900, right: 1000 }, 1440)).toBe(988)
  expect(roomFor('center', { left: 145, right: 245 }, 390)).toBeUndefined()
})
