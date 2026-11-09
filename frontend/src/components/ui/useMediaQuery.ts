import { useCallback, useSyncExternalStore } from 'react'

/**
 * Whether a `media` rule from `ui/media` currently applies, for layouts that move content
 * between places rather than restyle it. False where `matchMedia` is unavailable.
 */
export function useMediaQuery(rule: string) {
  const query = rule.replace(/^@media\s+/, '')
  // Stable per query, so React subscribes once rather than on every render.
  const subscribe = useCallback(
    (notify: () => void) => {
      if (typeof window.matchMedia !== 'function') {
        return () => undefined
      }
      const list = window.matchMedia(query)
      list.addEventListener('change', notify)
      return () => list.removeEventListener('change', notify)
    },
    [query],
  )

  return useSyncExternalStore(
    subscribe,
    () => typeof window.matchMedia === 'function' && window.matchMedia(query).matches,
    () => false,
  )
}
