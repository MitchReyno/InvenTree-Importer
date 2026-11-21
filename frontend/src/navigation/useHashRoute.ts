import { useSyncExternalStore } from 'react'

function subscribe(notify: () => void) {
  addEventListener('hashchange', notify)
  return () => removeEventListener('hashchange', notify)
}

function snapshot() {
  return location.hash.slice(1)
}

/** The current hash route without its `#`, or `fallback` while the hash is empty. */
export function useHashRoute(fallback = '') {
  return useSyncExternalStore(subscribe, snapshot, () => '') || fallback
}
