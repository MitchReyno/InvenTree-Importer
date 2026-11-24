import { useSyncExternalStore } from 'react'

/** A chat message being sent, or one whose send went unconfirmed. */
export type PendingSend = {
  text: string
  key: string
  status: 'sending' | 'unconfirmed'
}

/**
 * Sends outlive the composer for as long as the page is open. An entry is written before the
 * request starts and removed only when it is confirmed or explicitly discarded.
 */
const pendingSends = new Map<string, PendingSend>()
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function setPendingSend(storeKey: string, value: PendingSend | undefined) {
  if (value) {
    pendingSends.set(storeKey, value)
  } else {
    pendingSends.delete(storeKey)
  }
  listeners.forEach((listener) => listener())
}

export function hasPendingSend(storeKey: string) {
  return pendingSends.has(storeKey)
}

/** The session's message in flight or unconfirmed, which the history shows at its end. */
export function usePendingSend(storeKey: string) {
  return useSyncExternalStore(subscribe, () => pendingSends.get(storeKey))
}
