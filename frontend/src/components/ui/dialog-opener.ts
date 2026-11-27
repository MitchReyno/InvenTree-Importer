// Safari does not focus a button when it is clicked, so the focused element is not always the
// control that opened a dialog. The click is recorded until the end of its task, which covers a
// dialog that React opens while handling that click.
// Menu items are left out: a menu closes as it acts and returns focus to its own trigger.
const ACTIVATING = 'button, a[href], [role="button"], summary'
const TRANSIENT = '[role="menu"], [role="menuitem"]'

let clicked: HTMLElement | null = null

function recordClick(event: MouseEvent) {
  const target = event.target
  if (!(target instanceof Element)) {
    return
  }
  const control = target.closest<HTMLElement>(ACTIVATING)
  clicked = control?.closest(TRANSIENT) ? null : control
  setTimeout(() => {
    clicked = null
  }, 0)
}

/** Starts recording clicks for `dialogOpener`; returns the function that stops it. */
export function trackDialogOpeners(target: Document = document) {
  target.addEventListener('click', recordClick, true)
  return () => target.removeEventListener('click', recordClick, true)
}

/** The control that opened a dialog: the one just clicked, or else the focused element. */
export function dialogOpener(): HTMLElement | null {
  if (clicked?.isConnected) {
    return clicked
  }
  const active = document.activeElement
  return active instanceof HTMLElement ? active : null
}
