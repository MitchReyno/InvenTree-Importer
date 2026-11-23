import { useRef, type MouseEvent, type PointerEvent } from 'react'

type BackdropHandlers = {
  onPointerDown: (event: PointerEvent<HTMLDialogElement>) => void
  onPointerUp: (event: PointerEvent<HTMLDialogElement>) => void
  onPointerCancel: (event: PointerEvent<HTMLDialogElement>) => void
  onClick: (event: MouseEvent<HTMLDialogElement>) => void
}

const PRIMARY_BUTTON = 0

/**
 * Calls `onBackdropClick` when one pointer presses and releases a modal `<dialog>`'s dimmed
 * backdrop. A press inside the dialog, such as selecting text, never counts, wherever it ends.
 */
export function useBackdropClick(onBackdropClick: () => void): BackdropHandlers {
  // Each pointer's press, keyed by pointer ID, so a second pointer cannot arm another's release.
  const pressedOnBackdrop = useRef(new Map<number, boolean>())
  // Whether the release that the next click follows was a whole gesture on the backdrop.
  const releasedOnBackdrop = useRef(false)

  return {
    onPointerDown(event) {
      const onBackdrop = event.button === PRIMARY_BUTTON && isOnBackdrop(event)
      pressedOnBackdrop.current.set(event.pointerId, onBackdrop)
    },

    onPointerUp(event) {
      const pressed = pressedOnBackdrop.current.get(event.pointerId) ?? false
      pressedOnBackdrop.current.delete(event.pointerId)
      releasedOnBackdrop.current = pressed && isOnBackdrop(event)
    },

    onPointerCancel(event) {
      pressedOnBackdrop.current.delete(event.pointerId)
      releasedOnBackdrop.current = false
    },

    // The release decided the geometry: a click's coordinates may be rounded across an edge.
    onClick(event) {
      const released = releasedOnBackdrop.current
      releasedOnBackdrop.current = false
      if (released && event.target === event.currentTarget) {
        onBackdropClick()
      }
    },
  }
}

// A modal's ::backdrop reports the dialog as its target, as does the dialog's own padding,
// so only a point outside the dialog's border box is the backdrop.
function isOnBackdrop(event: MouseEvent<HTMLDialogElement>): boolean {
  const dialog = event.currentTarget
  if (event.target !== dialog) {
    return false
  }

  const box = dialog.getBoundingClientRect()
  const insideX = event.clientX >= box.left && event.clientX <= box.right
  const insideY = event.clientY >= box.top && event.clientY <= box.bottom
  return !(insideX && insideY)
}
