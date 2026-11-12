import { useCallback, useEffect, useRef, useState } from 'react'
import { appPage } from './app-route'
import {
  settingsReturnAfter,
  storeSettingsReturn,
  storedSettingsReturn,
  withSettingsReturn,
} from './settings-return'

/** The return route stored with the current history entry, read only on a Settings route. */
function storedSettingsReturnFor(route: string) {
  return appPage(route) === 'settings' ? storedSettingsReturn(history.state) : undefined
}

/**
 * Accept routes only when the mounted fact form can safely be left. Also follows the screen that
 * opened Settings, which its back link returns to.
 */
export function useNavigationGuard() {
  const [route, setRoute] = useState(() => location.hash.slice(1))
  const [settingsReturn, setSettingsReturn] = useState(() => storedSettingsReturnFor(route))
  const accepted = useRef({ route, settingsReturn })
  const [navigationBlocked, setNavigationBlocked] = useState(false)
  const dirty = useRef(false)
  const protectedUrl = useRef<string | null>(null)
  const onDirtyChange = useCallback((value: boolean) => {
    if (value && !dirty.current) {
      protectedUrl.current = location.href
    }
    dirty.current = value
    if (!value) {
      protectedUrl.current = null
      setNavigationBlocked(false)
    }
  }, [])

  useEffect(() => {
    function acceptRoute() {
      if (dirty.current) {
        if (protectedUrl.current && location.href !== protectedUrl.current) {
          // Restore the editor URL without consuming the requested history destination.
          // Retrying Back after save/discard can still reach that destination.
          history.pushState(
            withSettingsReturn(history.state, accepted.current.settingsReturn),
            '',
            protectedUrl.current,
          )
          setNavigationBlocked(true)
        }
        return
      }
      const next = location.hash.slice(1)
      // Back or Forward to a Settings entry restores the return route stored with it.
      const stored = storedSettingsReturnFor(next)
      const returnTo =
        stored ?? settingsReturnAfter(accepted.current.route, next, accepted.current.settingsReturn)
      if (returnTo !== undefined && stored === undefined) {
        storeSettingsReturn(returnTo)
      }
      accepted.current = { route: next, settingsReturn: returnTo }
      setRoute(next)
      setSettingsReturn(returnTo)
    }

    function guardLink(event: MouseEvent) {
      if (
        !dirty.current ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey
      ) {
        return
      }
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (
        !(anchor instanceof HTMLAnchorElement) ||
        anchor.download ||
        (anchor.target && anchor.target !== '_self')
      ) {
        return
      }
      const target = new URL(anchor.href)
      if (
        target.origin === location.origin &&
        target.pathname === location.pathname &&
        target.search === location.search &&
        target.hash !== location.hash
      ) {
        event.preventDefault()
        setNavigationBlocked(true)
      }
    }

    function guardUnload(event: BeforeUnloadEvent) {
      if (dirty.current) {
        event.preventDefault()
        event.returnValue = ''
      }
    }

    addEventListener('hashchange', acceptRoute)
    addEventListener('popstate', acceptRoute)
    addEventListener('beforeunload', guardUnload)
    document.addEventListener('click', guardLink, true)
    return () => {
      removeEventListener('hashchange', acceptRoute)
      removeEventListener('popstate', acceptRoute)
      removeEventListener('beforeunload', guardUnload)
      document.removeEventListener('click', guardLink, true)
    }
  }, [])
  return { route, settingsReturn, navigationBlocked, onDirtyChange }
}
