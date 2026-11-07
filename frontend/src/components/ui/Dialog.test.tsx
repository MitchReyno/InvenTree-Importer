import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { expect, test, vi } from 'vitest'
import { Dialog } from './Dialog'

function Opener({ closeDisabled = false }: { closeDisabled?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Merge lots
      </button>
      {open && (
        <Dialog title="Merge 2 lots" onClose={() => setOpen(false)} closeDisabled={closeDisabled}>
          <p>Their evidence stays linked.</p>
        </Dialog>
      )}
    </>
  )
}

test('opens a dialog named by its title and closes from its Close button', async () => {
  const user = userEvent.setup()
  render(<Opener />)
  await user.click(screen.getByRole('button', { name: 'Merge lots' }))

  expect(screen.getByRole('dialog', { name: 'Merge 2 lots' })).toBeVisible()
  expect(screen.getByRole('heading', { name: 'Merge 2 lots' })).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Close' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Merge lots' })).toHaveFocus()
})

test('Escape cancels unless closing is blocked', async () => {
  const onClose = vi.fn()
  const { rerender } = render(
    <Dialog title="Crop" onClose={onClose}>
      <p>Body</p>
    </Dialog>,
  )
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }))
  expect(onClose).toHaveBeenCalledTimes(1)

  rerender(
    <Dialog title="Crop" onClose={onClose} closeDisabled>
      <p>Body</p>
    </Dialog>,
  )
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }))
  expect(onClose).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled()
})
