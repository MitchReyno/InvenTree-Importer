import { useSyncExternalStore } from 'react'

// How many modals are open. Radix hides only the page content present when a modal opens, so
// content that mounts behind it later, such as a toast, reads this to hide itself.
let openModals = 0
const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) {
    listener()
  }
}

/** Counts a modal as open until the returned function is called. */
export function registerOpenModal() {
  openModals += 1
  notify()
  return () => {
    openModals -= 1
    notify()
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function anyModalOpen() {
  return openModals > 0
}

function noModalOnServer() {
  return false
}

/** Whether any modal is open, for page content that must stay out of reach behind it. */
export function useAnyModalOpen() {
  return useSyncExternalStore(subscribe, anyModalOpen, noModalOnServer)
}
