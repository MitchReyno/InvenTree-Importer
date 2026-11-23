// Safari does not focus a button when it is clicked, so the focused element is not always the
// control that opened a dialog. The click is recorded until the end of its task, which covers a
// dialog that React opens while handling that click.
const ACTIVATING = 'button, a[href], [role="button"], [role="menuitem"], summary'

let clicked: HTMLElement | null = null

function recordClick(event: MouseEvent) {
  const target = event.target
  if (!(target instanceof Element)) {
    return
  }
  clicked = target.closest<HTMLElement>(ACTIVATING)
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
