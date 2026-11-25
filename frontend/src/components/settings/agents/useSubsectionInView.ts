import { useCallback, useState, useSyncExternalStore } from 'react'
import type { AgentSubsectionId } from '#/navigation/app-route'
import { subsectionHeadingId } from './AgentSubsection'

/** The reading line sits this far down the window; the heading last above it is being read. */
const READING_LINE_FRACTION = 0.25
/** Within this many px of the bottom the page counts as scrolled to its end. */
const PAGE_END_PX = 2
/** Where `scrollend` isn't supported, a scroll has ended after this long without a scroll event. */
const SCROLL_IDLE_MS = 150

/** The subsection whose heading most recently passed the reading line, as the page is laid out now. */
function subsectionAtReadingLine(ids: readonly AgentSubsectionId[]) {
  const atPageEnd =
    window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - PAGE_END_PX
  if (atPageEnd) {
    return ids.at(-1)
  }
  const readingLine = window.innerHeight * READING_LINE_FRACTION
  const passed = ids.filter((id) => {
    const heading = document.getElementById(subsectionHeadingId(id))

    return heading !== null && heading.getBoundingClientRect().top <= readingLine
  })

  return passed.at(-1) ?? ids[0]
}

/**
 * Follows the window's scroll position. Only scrolling by hand forms a reading: opening the page,
 * every hash navigation (a link, Back, a typed address) and every scroll the page makes to a
 * subsection (`pause`) hold it until the scroll they start ends, so the route decides meanwhile
 * and the scroll never steps through the sections between.
 */
function scrollReading(ids: readonly AgentSubsectionId[]) {
  let current: AgentSubsectionId | undefined
  let frame: number | undefined
  let idle: ReturnType<typeof setTimeout> | undefined
  let paused = false
  // Set while subscribed; a pause outside a subscription has nothing to hold.
  let notify: (() => void) | undefined

  function publish(next: AgentSubsectionId | undefined) {
    if (next !== current) {
      current = next
      notify?.()
    }
  }

  function cancelFrame() {
    if (frame !== undefined) {
      cancelAnimationFrame(frame)
      frame = undefined
    }
  }

  function resume() {
    paused = false
    clearTimeout(idle)
  }

  function waitForIdle() {
    clearTimeout(idle)
    idle = setTimeout(resume, SCROLL_IDLE_MS)
  }

  function pause() {
    if (!notify) {
      return
    }
    paused = true
    cancelFrame()
    waitForIdle()
    publish(undefined)
  }

  function measure() {
    frame = undefined
    publish(subsectionAtReadingLine(ids))
  }

  function handleScroll() {
    if (paused) {
      waitForIdle()
      return
    }
    frame ??= requestAnimationFrame(measure)
  }

  return {
    snapshot: () => current,
    pause,

    subscribe(listener: () => void) {
      notify = listener
      pause()
      addEventListener('scroll', handleScroll, { passive: true })
      addEventListener('scrollend', resume)
      addEventListener('hashchange', pause)
      addEventListener('popstate', pause)
      return () => {
        removeEventListener('scroll', handleScroll)
        removeEventListener('scrollend', resume)
        removeEventListener('hashchange', pause)
        removeEventListener('popstate', pause)
        cancelFrame()
        clearTimeout(idle)
        paused = false
        current = undefined
        notify = undefined
      }
    },
  }
}

/**
 * The Settings › Agents subsection being read, from the window's scroll: the one whose heading
 * most recently passed a line a quarter of the way down the window, the first before any has,
 * and the last at the end of the page. `inView` is undefined while `enabled` is off, until the
 * operator scrolls by hand, and while a navigation's own scroll runs; the route decides then.
 * Call `pause` just before the page scrolls itself to a subsection.
 */
export function useSubsectionInView(ids: readonly AgentSubsectionId[], enabled: boolean) {
  const [reading] = useState(() => scrollReading(ids))
  // Stable per `enabled`, so React subscribes again only when following starts or stops.
  const subscribe = useCallback(
    (listener: () => void) => (enabled ? reading.subscribe(listener) : () => undefined),
    [reading, enabled],
  )
  const inView = useSyncExternalStore(subscribe, reading.snapshot, () => undefined)

  return { inView: enabled ? inView : undefined, pause: reading.pause }
}
