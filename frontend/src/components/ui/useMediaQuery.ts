import { useSyncExternalStore } from 'react'

/**
 * Whether a `media` rule from `ui/media` currently applies, for layouts that move content
 * between places rather than restyle it. False where `matchMedia` is unavailable.
 */
export function useMediaQuery(rule: string) {
  const query = rule.replace(/^@media\s+/, '')

  return useSyncExternalStore(
    (notify) => {
      if (typeof window.matchMedia !== 'function') {
        return () => undefined
      }
      const list = window.matchMedia(query)
      list.addEventListener('change', notify)
      return () => list.removeEventListener('change', notify)
    },
    () => typeof window.matchMedia === 'function' && window.matchMedia(query).matches,
    () => false,
  )
}
