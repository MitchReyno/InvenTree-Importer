import { useEffect, useState } from 'react'

/**
 * Whether an element has left the viewport, followed through `IntersectionObserver` while
 * `enabled`. False when disabled or where the observer is unavailable.
 */
export function useOutOfView(enabled: boolean) {
  const [element, setElement] = useState<HTMLElement | null>(null)
  const [outOfView, setOutOfView] = useState(false)

  useEffect(() => {
    if (!enabled || !element || typeof IntersectionObserver !== 'function') {
      return
    }
    const observer = new IntersectionObserver(([entry]) => setOutOfView(!entry.isIntersecting))
    observer.observe(element)

    return () => observer.disconnect()
  }, [enabled, element])

  return { ref: setElement, outOfView: enabled && outOfView }
}
