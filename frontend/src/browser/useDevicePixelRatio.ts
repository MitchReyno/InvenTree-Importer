import { useSyncExternalStore } from 'react'

function snapshot() {
  return globalThis.devicePixelRatio ?? 1
}

function subscribe(notify: () => void) {
  if (typeof matchMedia !== 'function') {
    return () => undefined
  }
  let query: MediaQueryList | undefined

  // A resolution query matches one ratio only, so each change arms a query for the new one.
  function arm() {
    query?.removeEventListener('change', changed)
    query = matchMedia(`(resolution: ${snapshot()}dppx)`)
    query.addEventListener('change', changed)
  }

  function changed() {
    arm()
    notify()
  }

  arm()
  return () => query?.removeEventListener('change', changed)
}

/** The display's device pixel ratio, which changes when a window moves between screens. */
export function useDevicePixelRatio() {
  return useSyncExternalStore(subscribe, snapshot, () => 1)
}
