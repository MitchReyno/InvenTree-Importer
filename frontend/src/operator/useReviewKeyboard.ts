import { useEffect, useRef } from 'react'

export interface ReviewShortcuts {
  next: () => void
  previous: () => void
  markReviewed: () => void
  editQuantity: () => void
  viewEvidence: () => void
}

/** Typing in a field, a modifier chord or an open dialog never triggers a shortcut. */
export function isShortcutTarget(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) {
    return false
  }
  if (document.querySelector('dialog[open]')) {
    return false
  }
  const target = event.target
  if (!(target instanceof HTMLElement)) {
    return true
  }
  if (target.isContentEditable) {
    return false
  }
  return !['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

/** J/K move, R mark the focused lot reviewed, E edit quantity, V focus evidence. */
export function useReviewKeyboard(shortcuts: ReviewShortcuts, enabled: boolean) {
  const current = useRef(shortcuts)
  current.current = shortcuts

  useEffect(() => {
    if (!enabled) {
      return
    }

    function handle(event: KeyboardEvent) {
      if (!isShortcutTarget(event)) {
        return
      }
      const actions: Record<string, () => void> = {
        j: current.current.next,
        k: current.current.previous,
        r: current.current.markReviewed,
        e: current.current.editQuantity,
        v: current.current.viewEvidence,
      }
      const action = actions[event.key.toLowerCase()]
      if (action) {
        event.preventDefault()
        action()
      }
    }

    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [enabled])
}
