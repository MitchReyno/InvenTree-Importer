import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode, useState } from 'react'
import { expect, test, vi } from 'vitest'
import { Dialog } from './Dialog'
import { trackDialogOpeners } from './dialog-opener'
import { Popover } from './Popover'
import { Toast } from './Toast'
import { AutoValueField, type AutoValue } from '#/forms/AutoValueField'

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

// Browsers refuse focus inside an inert subtree; jsdom does not, so it is modelled here.
function enforceInertFocus() {
  const realFocus = HTMLElement.prototype.focus
  return vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (
    this: HTMLElement,
    options?: FocusOptions,
  ) {
    if (this.closest('[inert]')) {
      return
    }
    realFocus.call(this, options)
  })
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
  expect(screen.getByRole('dialog', { name: 'Merge 2 lots' })).toHaveAttribute('aria-modal', 'true')
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

function SettingsDialog({ onClose, choose }: { onClose: () => void; choose: () => void }) {
  const [open, setOpen] = useState(true)
  const [dateCode, setDateCode] = useState<AutoValue>({ mode: 'auto' })
  if (!open) {
    return null
  }
  return (
    <Dialog
      title="Lot settings"
      onClose={() => {
        onClose()
        setOpen(false)
      }}
    >
      <Popover label="Quantity mode" trigger={<button type="button">Quantity</button>}>
        <button type="button" onClick={choose}>
          Estimated
        </button>
      </Popover>
      <AutoValueField label="Date code" type="text" value={dateCode} onChange={setDateCode} />
    </Dialog>
  )
}

test('popovers opened inside a dialog stay usable and do not close it', async () => {
  const user = userEvent.setup()
  const onClose = vi.fn()
  const choose = vi.fn()
  render(<SettingsDialog onClose={onClose} choose={choose} />)
  await afterOpen()
  const dialog = screen.getByRole('dialog', { name: 'Lot settings' })

  await user.click(screen.getByRole('button', { name: 'Quantity' }))
  const option = await screen.findByRole('button', { name: 'Estimated' })
  // It renders inside the dialog, so it stacks above it and stays in its focus scope.
  expect(dialog).toContainElement(option)
  await user.click(option)
  expect(choose).toHaveBeenCalledOnce()

  await user.click(screen.getByRole('button', { name: /^Date code/ }))
  const none = await screen.findByRole('radio', { name: 'None' })
  expect(dialog).toContainElement(none)
  await user.click(none)
  expect(screen.getByRole('button', { name: /^Date code/ })).toHaveAccessibleName(/No value/)

  expect(onClose).not.toHaveBeenCalled()
  expect(screen.getByRole('dialog', { name: 'Lot settings' })).toBeInTheDocument()
})

test('an open dialog makes the page behind it inert, as a native modal did, then restores it', async () => {
  const user = userEvent.setup()
  render(
    <>
      <Toast
        message="Deleted Front label"
        action={{ label: 'Undo', onClick: vi.fn() }}
        onDismiss={vi.fn()}
      />
      {/* A masthead control that holds a live status, which Radix alone leaves exposed. */}
      <button type="button">
        Workflow activity <span aria-live="polite">2 running</span>
      </button>
      <Opener />
    </>,
  )
  expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Merge lots' }))
  await afterOpen()
  expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  expect(screen.queryByRole('button', { name: /Workflow activity/ })).toBeNull()
  expect(screen.getByText('2 running').closest('[inert]')).not.toBeNull()

  await user.click(screen.getByRole('button', { name: 'Close' }))
  expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Workflow activity/ })).toBeInTheDocument()
  expect(document.querySelector('[inert]')).toBeNull()
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

  // The dialog's result takes focus as it mounts, so the page must be live again by then.
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

  const focus = enforceInertFocus()
  try {
    render(<MovesFocus />)
    await user.click(screen.getByRole('button', { name: 'Delete file' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByRole('button', { name: 'Undo' })).toHaveFocus()
  } finally {
    focus.mockRestore()
  }
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

test('a dialog opened from a menu item returns focus to the menu trigger, not the item', async () => {
  const user = userEvent.setup()

  // As ActionsMenu does: choosing an item focuses the trigger while the item animates out.
  function MenuOpener() {
    const [open, setOpen] = useState(false)
    return (
      <>
        <button type="button" id="actions">
          Actions for Front label
        </button>
        <div role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              document.getElementById('actions')?.focus()
              setOpen(true)
            }}
          >
            Open
          </button>
        </div>
        {open && (
          <Dialog title="Front label" onClose={() => setOpen(false)}>
            <p>Viewer</p>
          </Dialog>
        )}
      </>
    )
  }

  const stopTracking = trackDialogOpeners()
  try {
    render(<MenuOpener />)
    await user.click(screen.getByRole('menuitem', { name: 'Open' }))
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.getByRole('button', { name: 'Actions for Front label' })).toHaveFocus()
  } finally {
    stopTracking()
  }
})

test('a dialog opened by a click that left focus on the page closes from its backdrop back to that control', async () => {
  const user = userEvent.setup()
  const stopTracking = trackDialogOpeners()
  try {
    render(<Opener />)
    ;(document.activeElement as HTMLElement | null)?.blur()
    // As Safari does: the click opens the dialog with focus still on the page.
    fireEvent.click(screen.getByRole('button', { name: 'Merge lots' }))
    await afterOpen()

    await user.click(backdrop())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Merge lots' })).toHaveFocus()
  } finally {
    stopTracking()
  }
})

test('a dialog over another whose opener became disabled returns focus to the dialog beneath', async () => {
  const user = userEvent.setup()

  // As the crop editor over the evidence viewer: a failed read disables its opener meanwhile.
  function Stacked() {
    const [inner, setInner] = useState(false)
    const [disabled, setDisabled] = useState(false)
    return (
      <Dialog title="Front label" onClose={vi.fn()}>
        <button type="button" disabled={disabled} onClick={() => setInner(true)}>
          Prepare crop / rotation
        </button>
        {inner && (
          <Dialog
            title="Prepare documentary crop"
            onClose={() => {
              setDisabled(true)
              setInner(false)
            }}
          >
            <p>Crop</p>
          </Dialog>
        )}
      </Dialog>
    )
  }

  render(<Stacked />)
  await user.click(screen.getByRole('button', { name: 'Prepare crop / rotation' }))
  await user.click(
    within(screen.getByRole('dialog', { name: 'Prepare documentary crop' })).getByRole('button', {
      name: 'Close',
    }),
  )
  expect(screen.getByRole('heading', { name: 'Front label' })).toHaveFocus()
})

test('a toast that appears while a dialog is open keeps its Undo out of reach until it closes', async () => {
  const user = userEvent.setup()

  function LateToast() {
    const [open, setOpen] = useState(true)
    const [toast, setToast] = useState(false)
    return (
      <>
        {toast && (
          <Toast
            message="Moved 1 file"
            action={{ label: 'Undo', onClick: vi.fn() }}
            onDismiss={vi.fn()}
          />
        )}
        {open && (
          <Dialog title="Back marking" onClose={() => setOpen(false)}>
            <button type="button" onClick={() => setToast(true)}>
              Confirm the move
            </button>
          </Dialog>
        )}
      </>
    )
  }

  render(<LateToast />)
  await user.click(screen.getByRole('button', { name: 'Confirm the move' }))
  expect(screen.getByText('Moved 1 file')).toBeInTheDocument()
  // It mounts inside the page the dialog made inert, so it is out of reach too.
  const undo = screen.getByText('Undo').closest('button')
  expect(undo?.closest('[inert]')).not.toBeNull()
  expect(undo?.closest('[aria-hidden="true"]')).not.toBeNull()

  await user.click(screen.getByRole('button', { name: 'Close' }))
  expect(screen.getByRole('button', { name: 'Undo' }).closest('[inert]')).toBeNull()
})

test('the page stays inert while the crop editor stays open over a viewer that closed beneath it', async () => {
  const user = userEvent.setup()

  // As MediaWorkspace mounts them: the viewer and the crop editor are separate modals, and a
  // refresh that moves the file unmounts the viewer while the crop editor stays open.
  function Stacked() {
    const [viewer, setViewer] = useState(true)
    const [crop, setCrop] = useState(false)
    return (
      <>
        <button type="button">
          Workflow activity <span aria-live="polite">2 running</span>
        </button>
        {viewer && (
          <Dialog title="Front label" onClose={() => setViewer(false)}>
            <button type="button" onClick={() => setCrop(true)}>
              Prepare crop / rotation
            </button>
          </Dialog>
        )}
        {crop && (
          <Dialog title="Prepare documentary crop" onClose={() => setCrop(false)}>
            <button type="button" onClick={() => setViewer(false)}>
              Refresh moves the file
            </button>
          </Dialog>
        )}
      </>
    )
  }

  render(<Stacked />)
  await user.click(screen.getByRole('button', { name: 'Prepare crop / rotation' }))
  await afterOpen()
  await user.click(screen.getByRole('button', { name: 'Refresh moves the file' }))
  expect(screen.queryByRole('dialog', { name: 'Front label' })).toBeNull()

  const page = screen.getByText('2 running')
  expect(page.closest('[inert]')).not.toBeNull()
  expect(page.closest('[aria-hidden="true"]')).not.toBeNull()
  expect(screen.queryByRole('button', { name: /Workflow activity/ })).toBeNull()

  await user.click(
    within(screen.getByRole('dialog', { name: 'Prepare documentary crop' })).getByRole('button', {
      name: 'Close',
    }),
  )
  expect(screen.getByRole('button', { name: /Workflow activity/ })).toBeInTheDocument()
  expect(document.querySelector('[inert]')).toBeNull()
})

test('of two dialogs that open in the same commit, the later one stays usable on top', async () => {
  const user = userEvent.setup()
  const onCrop = vi.fn()
  const focus = enforceInertFocus()
  try {
    render(
      <>
        <Dialog title="Front label" onClose={vi.fn()}>
          <p>Viewer</p>
        </Dialog>
        <Dialog title="Prepare documentary crop" onClose={vi.fn()}>
          <button type="button" onClick={onCrop}>
            Prepare new version
          </button>
        </Dialog>
      </>,
    )
    const top = screen.getByRole('dialog', { name: 'Prepare documentary crop' })
    expect(top.closest('[inert]')).toBeNull()
    expect(top.closest('[aria-hidden="true"]')).toBeNull()
    expect(screen.getByText('Viewer').closest('[inert]')).not.toBeNull()

    await user.click(within(top).getByRole('button', { name: 'Prepare new version' }))
    expect(onCrop).toHaveBeenCalledOnce()
  } finally {
    focus.mockRestore()
  }
})
