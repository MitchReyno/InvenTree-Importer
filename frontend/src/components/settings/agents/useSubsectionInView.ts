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
 * Follows the window's scroll position. Only scrolling by hand forms a reading: opening the page
 * and every hash navigation (a link, Back, a typed address) pause it until the scroll they start
 * ends, so the route decides meanwhile and the scroll never steps through the sections between.
 */
function scrollReading(ids: readonly AgentSubsectionId[]) {
  let current: AgentSubsectionId | undefined
  let frame: number | undefined
  let idle: ReturnType<typeof setTimeout> | undefined
  let paused = false

  return {
    snapshot: () => current,

    subscribe(notify: () => void) {
      function publish(next: AgentSubsectionId | undefined) {
        if (next !== current) {
          current = next
          notify()
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
        paused = true
        if (frame !== undefined) {
          cancelAnimationFrame(frame)
          frame = undefined
        }
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
        if (frame !== undefined) {
          cancelAnimationFrame(frame)
          frame = undefined
        }
        clearTimeout(idle)
        current = undefined
      }
    },
  }
}

/**
 * The Settings › Agents subsection being read, from the window's scroll: the one whose heading
 * most recently passed a line a quarter of the way down the window, the first before any has,
 * and the last at the end of the page. Undefined while `enabled` is off, until the operator
 * scrolls by hand, and while a navigation's own scroll runs; the route decides then.
 */
export function useSubsectionInView(ids: readonly AgentSubsectionId[], enabled: boolean) {
  const [reading] = useState(() => scrollReading(ids))
  // Stable per `enabled`, so React subscribes again only when following starts or stops.
  const subscribe = useCallback(
    (notify: () => void) => (enabled ? reading.subscribe(notify) : () => undefined),
    [reading, enabled],
  )

  const inView = useSyncExternalStore(subscribe, reading.snapshot, () => undefined)

  return enabled ? inView : undefined
}
