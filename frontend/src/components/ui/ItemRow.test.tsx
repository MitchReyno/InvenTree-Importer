import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { ItemRow } from './ItemRow'
import { Pill } from './Pill'

it('opens the item from the whole row, with its state as the description', async () => {
  const onOpen = vi.fn()
  render(
    <ItemRow
      id="lot-a"
      title="Packet A"
      meta="25 pieces"
      state={<Pill status="ready">Reviewed</Pill>}
      openLabel="Show Packet A"
      current
      leading={<input type="checkbox" aria-label="Select Packet A" />}
      onOpen={onOpen}
    />,
  )
  const row = screen.getByRole('button', { name: 'Show Packet A' })
  expect(row).toHaveAccessibleDescription(/Reviewed/)
  expect(row).toHaveAttribute('aria-current', 'true')
  expect(row.querySelector('[data-thumb]')).not.toBeNull()
  expect(screen.getByRole('checkbox', { name: 'Select Packet A' })).toBeInTheDocument()
  await userEvent.click(row)
  expect(onOpen).toHaveBeenCalledTimes(1)
})
