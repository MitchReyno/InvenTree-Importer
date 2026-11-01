import { useCallback, useEffect, useRef, useState } from 'react'

/** Accept routes only when the mounted fact form can safely be left. */
export function useNavigationGuard() {
  const [route, setRoute] = useState(() => location.hash.slice(1))
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
          history.pushState(history.state, '', protectedUrl.current)
          setNavigationBlocked(true)
        }
        return
      }
      setRoute(location.hash.slice(1))
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
  return { route, navigationBlocked, onDirtyChange }
}
