import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode, useState } from 'react'
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

test('focus returns to the opener after a StrictMode replay, while the open modal keeps the page inert', async () => {
  const realFocus = HTMLElement.prototype.focus
  // Browsers ignore focus outside an open modal dialog; jsdom does not, so it is modelled here.
  const focus = vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (
    this: HTMLElement,
    options?: FocusOptions,
  ) {
    const modal = document.querySelector('dialog[open]')
    if (modal && !modal.contains(this)) {
      return
    }
    realFocus.call(this, options)
  })
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true
      this.querySelector('button')?.focus()
    },
  })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = false
    },
  })
  try {
    const user = userEvent.setup()
    render(
      <StrictMode>
        <Opener />
      </StrictMode>,
    )
    await user.click(screen.getByRole('button', { name: 'Merge lots' }))
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.getByRole('button', { name: 'Merge lots' })).toHaveFocus()
  } finally {
    focus.mockRestore()
    delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).showModal
    delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).close
  }
})

function OpenerWithFallback({ fromPage = false }: { fromPage?: boolean }) {
  const [open, setOpen] = useState(fromPage)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open session
      </button>
      <button type="button">Session row</button>
      {open && (
        <Dialog
          title="Session"
          onClose={() => setOpen(false)}
          returnFocus={() => screen.getByRole('button', { name: 'Session row' })}
        >
          <p>Timeline</p>
        </Dialog>
      )}
    </>
  )
}

test('closing returns focus to the fallback when the dialog opened with focus on the page', async () => {
  const user = userEvent.setup()
  ;(document.activeElement as HTMLElement | null)?.blur()
  render(<OpenerWithFallback fromPage />)
  expect(document.activeElement).toBe(document.body)

  await user.click(screen.getByRole('button', { name: 'Close' }))
  expect(screen.getByRole('button', { name: 'Session row' })).toHaveFocus()
})

test('closing returns focus to a connected opener rather than the fallback', async () => {
  const user = userEvent.setup()
  render(<OpenerWithFallback />)
  await user.click(screen.getByRole('button', { name: 'Open session' }))

  await user.click(screen.getByRole('button', { name: 'Close' }))
  expect(screen.getByRole('button', { name: 'Open session' })).toHaveFocus()
})
