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

// jsdom has no layout, so the dialog's box is stubbed: x 100–500, y 0–600.
const DIALOG_BOX = { left: 100, right: 500, top: 0, bottom: 600 }
const BACKDROP_POINT = { clientX: 40, clientY: 300 }
const PADDING_POINT = { clientX: 104, clientY: 300 }

function renderBackdropDialog({ closeDisabled = false } = {}) {
  const onClose = vi.fn()
  render(
    <Dialog title="Session" onClose={onClose} closeDisabled={closeDisabled}>
      <p>Timeline</p>
    </Dialog>,
  )
  const dialog = screen.getByRole('dialog')
  vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue(
    DOMRect.fromRect({
      x: DIALOG_BOX.left,
      y: DIALOG_BOX.top,
      width: DIALOG_BOX.right - DIALOG_BOX.left,
      height: DIALOG_BOX.bottom - DIALOG_BOX.top,
    }),
  )
  return { dialog, onClose }
}

test('a click on the backdrop closes the dialog', () => {
  const { dialog, onClose } = renderBackdropDialog()
  fireEvent.pointerDown(dialog, BACKDROP_POINT)
  fireEvent.click(dialog, BACKDROP_POINT)
  expect(onClose).toHaveBeenCalledTimes(1)
})

test('a backdrop click is ignored while closing is disabled', () => {
  const { dialog, onClose } = renderBackdropDialog({ closeDisabled: true })
  fireEvent.pointerDown(dialog, BACKDROP_POINT)
  fireEvent.click(dialog, BACKDROP_POINT)
  expect(onClose).not.toHaveBeenCalled()
})

test('a press that starts inside the dialog and ends on the backdrop does not close it', () => {
  const { dialog, onClose } = renderBackdropDialog()

  // Selecting text: the press is on the content, and the click lands on the dialog.
  fireEvent.pointerDown(screen.getByText('Timeline'), { clientX: 200, clientY: 300 })
  fireEvent.click(dialog, BACKDROP_POINT)
  // A press on the surface's padding targets the dialog itself, but lies inside its box.
  fireEvent.pointerDown(dialog, PADDING_POINT)
  fireEvent.click(dialog, BACKDROP_POINT)
  expect(onClose).not.toHaveBeenCalled()
})

test('a press on the backdrop released inside the dialog does not close it', () => {
  const { dialog, onClose } = renderBackdropDialog()
  fireEvent.pointerDown(dialog, BACKDROP_POINT)
  fireEvent.click(dialog, PADDING_POINT)
  expect(onClose).not.toHaveBeenCalled()
})

test('a click on the content does not close the dialog', () => {
  const { onClose } = renderBackdropDialog()
  const content = screen.getByText('Timeline')
  fireEvent.pointerDown(content, { clientX: 200, clientY: 300 })
  fireEvent.click(content, { clientX: 200, clientY: 300 })
  expect(onClose).not.toHaveBeenCalled()
})
