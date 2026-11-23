import { useRef, type MouseEvent, type PointerEvent } from 'react'

type BackdropHandlers = {
  onPointerDown: (event: PointerEvent<HTMLDialogElement>) => void
  onClick: (event: MouseEvent<HTMLDialogElement>) => void
}

/**
 * Calls `onBackdropClick` when a modal `<dialog>`'s dimmed backdrop is pressed and released.
 * A press inside the dialog, such as selecting text, never counts, wherever it is released.
 */
export function useBackdropClick(onBackdropClick: () => void): BackdropHandlers {
  const pressedOnBackdrop = useRef(false)

  return {
    onPointerDown(event) {
      pressedOnBackdrop.current = isOnBackdrop(event)
    },

    onClick(event) {
      const pressed = pressedOnBackdrop.current
      pressedOnBackdrop.current = false
      if (pressed && isOnBackdrop(event)) {
        onBackdropClick()
      }
    },
  }
}

// A modal's ::backdrop reports the dialog as its target, as does the dialog's own padding,
// so only a point outside the dialog's box is the backdrop.
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
