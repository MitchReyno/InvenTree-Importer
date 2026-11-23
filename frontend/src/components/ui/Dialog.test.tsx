import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode, useState } from 'react'
import { expect, test, vi } from 'vitest'
import { Dialog } from './Dialog'
import { trackDialogOpeners } from './dialog-opener'
import { Popover } from './Popover'

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

// The dimmed backdrop is the element rendered just before the dialog.
function backdrop() {
  const element = screen.getByRole('dialog').previousElementSibling
  if (!(element instanceof HTMLElement)) {
    throw new Error('the dialog has no backdrop')
  }
  return element
}

// Radix starts listening for outside presses a tick after the dialog opens.
async function afterOpen() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
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

test('Escape closes unless closing is blocked', async () => {
  const user = userEvent.setup()
  const onClose = vi.fn()
  const { rerender } = render(
    <Dialog title="Crop" onClose={onClose}>
      <p>Body</p>
    </Dialog>,
  )
  await user.keyboard('{Escape}')
  expect(onClose).toHaveBeenCalledTimes(1)

  rerender(
    <Dialog title="Crop" onClose={onClose} closeDisabled>
      <p>Body</p>
    </Dialog>,
  )
  await user.keyboard('{Escape}')
  expect(onClose).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled()
})

test('a click on the backdrop closes the dialog and returns focus to the opener', async () => {
  const user = userEvent.setup()
  render(<Opener />)
  await user.click(screen.getByRole('button', { name: 'Merge lots' }))
  await afterOpen()

  await user.click(backdrop())
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Merge lots' })).toHaveFocus()
})

test('a backdrop click is ignored while closing is disabled', async () => {
  const user = userEvent.setup()
  render(<Opener closeDisabled />)
  await user.click(screen.getByRole('button', { name: 'Merge lots' }))
  await afterOpen()

  await user.click(backdrop())
  expect(screen.getByRole('dialog', { name: 'Merge 2 lots' })).toBeInTheDocument()
})

test('a press that starts inside the dialog and ends on the backdrop does not close it', async () => {
  const user = userEvent.setup()
  render(<Opener />)
  await user.click(screen.getByRole('button', { name: 'Merge lots' }))
  await afterOpen()

  // Selecting text: the press is on the content, the release over the backdrop.
  await user.pointer([
    { keys: '[MouseLeft>]', target: screen.getByText('Their evidence stays linked.') },
    { target: backdrop() },
    { keys: '[/MouseLeft]' },
  ])
  // A press on the surface's own padding is inside the dialog too.
  await user.pointer([
    { keys: '[MouseLeft>]', target: screen.getByRole('dialog') },
    { target: backdrop() },
    { keys: '[/MouseLeft]' },
  ])
  expect(screen.getByRole('dialog', { name: 'Merge 2 lots' })).toBeInTheDocument()
})

test('a click on the content does not close the dialog', async () => {
  const user = userEvent.setup()
  render(<Opener />)
  await user.click(screen.getByRole('button', { name: 'Merge lots' }))
  await afterOpen()

  await user.click(screen.getByText('Their evidence stays linked.'))
  expect(screen.getByRole('dialog', { name: 'Merge 2 lots' })).toBeInTheDocument()
})

test('a popover opened inside a dialog stays usable and does not close the dialog', async () => {
  const user = userEvent.setup()
  const choose = vi.fn()
  render(
    <Dialog title="Lot settings" onClose={vi.fn()}>
      <Popover label="Quantity mode" trigger={<button type="button">Quantity</button>}>
        <button type="button" onClick={choose}>
          Estimated
        </button>
      </Popover>
    </Dialog>,
  )
  await afterOpen()

  await user.click(screen.getByRole('button', { name: 'Quantity' }))
  const option = await screen.findByRole('button', { name: 'Estimated' })
  // It renders inside the dialog, so it stacks above it and stays in its focus scope.
  expect(screen.getByRole('dialog', { name: 'Lot settings' })).toContainElement(option)
  await user.click(option)
  expect(choose).toHaveBeenCalledOnce()
  expect(screen.getByRole('dialog', { name: 'Lot settings' })).toBeInTheDocument()
})

test('focus returns to the opener after a StrictMode replay', async () => {
  const user = userEvent.setup()
  render(
    <StrictMode>
      <Opener />
    </StrictMode>,
  )
  await user.click(screen.getByRole('button', { name: 'Merge lots' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus())
  await user.click(screen.getByRole('button', { name: 'Close' }))
  expect(screen.getByRole('button', { name: 'Merge lots' })).toHaveFocus()
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
          returnFocus={() => screen.getByRole('button', { name: 'Session row', hidden: true })}
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
  expect(screen.getByRole('dialog', { name: 'Session' })).toBeInTheDocument()

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

test('focus the owner moves on close stays where the owner put it', async () => {
  const user = userEvent.setup()

  // As a confirmed delete does: the closed dialog's result takes focus as it mounts.
  function MovesFocus() {
    const [deleted, setDeleted] = useState(false)
    const [open, setOpen] = useState(false)
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Delete file
        </button>
        {deleted && (
          <button type="button" ref={(element) => element?.focus()}>
            Undo
          </button>
        )}
        {open && (
          <Dialog title="Delete file" onClose={() => setOpen(false)}>
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                setDeleted(true)
              }}
            >
              Delete
            </button>
          </Dialog>
        )}
      </>
    )
  }

  render(<MovesFocus />)
  await user.click(screen.getByRole('button', { name: 'Delete file' }))
  await user.click(screen.getByRole('button', { name: 'Delete' }))
  expect(screen.getByRole('button', { name: 'Undo' })).toHaveFocus()
})

test('a dialog opened by a click that left focus elsewhere returns focus to the clicked control', async () => {
  const user = userEvent.setup()
  const stopTracking = trackDialogOpeners()
  try {
    render(
      <>
        <button type="button">Elsewhere</button>
        <Opener />
      </>,
    )
    screen.getByRole('button', { name: 'Elsewhere' }).focus()
    // As Safari does: the click opens the dialog without focusing its button.
    fireEvent.click(screen.getByRole('button', { name: 'Merge lots' }))

    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.getByRole('button', { name: 'Merge lots' })).toHaveFocus()
  } finally {
    stopTracking()
  }
})
