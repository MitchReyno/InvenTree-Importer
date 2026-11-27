import { useSyncExternalStore } from 'react'

function subscribe(notify: () => void) {
  addEventListener('online', notify)
  addEventListener('offline', notify)
  return () => {
    removeEventListener('online', notify)
    removeEventListener('offline', notify)
  }
}

function snapshot() {
  return navigator.onLine !== false
}

/** Whether the browser reports a network connection. */
export function useOnline() {
  return useSyncExternalStore(subscribe, snapshot, () => true)
}
