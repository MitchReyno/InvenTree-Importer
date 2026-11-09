import { useEffect, useEffectEvent, useState } from 'react'

/**
 * Whether an element has left the viewport, followed through `IntersectionObserver` while
 * `enabled`. False when disabled or where the observer is unavailable. `onReturn` runs just before
 * the element is reported back in view, while whatever showed in its place is still mounted.
 */
export function useOutOfView(enabled: boolean, onReturn?: () => void) {
  const [element, setElement] = useState<HTMLElement | null>(null)
  const [outOfView, setOutOfView] = useState(false)
  const returned = useEffectEvent(() => onReturn?.())

  useEffect(() => {
    if (!enabled || !element || typeof IntersectionObserver !== 'function') {
      return
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        returned()
      }
      setOutOfView(!entry.isIntersecting)
    })
    observer.observe(element)

    return () => observer.disconnect()
  }, [enabled, element])

  return { ref: setElement, outOfView: enabled && outOfView }
}
