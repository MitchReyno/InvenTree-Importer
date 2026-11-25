import { act } from '@testing-library/react'
import { vi } from 'vitest'
import type { AgentSubsectionId } from '#/navigation/app-route'
import { subsectionHeadingId } from '#/components/settings/agents/AgentSubsection'

export const WINDOW_HEIGHT = 900
export const PAGE_HEIGHT = 4000

// Where each Settings › Agents heading sits on the page; the reading line is 225 px down.
const HEADING_TOP: Record<AgentSubsectionId, number> = {
  providers: 300,
  sessions: 900,
  models: 1400,
  instructions: 2300,
  descriptions: 2700,
  tags: 3200,
  research: 3500,
}

function setScrollY(y: number) {
  Object.defineProperty(window, 'scrollY', { configurable: true, value: y })
}

function headingTop(element: Element) {
  const entry = Object.entries(HEADING_TOP).find(
    ([id]) => element.id === subsectionHeadingId(id as AgentSubsectionId),
  )

  return entry ? entry[1] - window.scrollY : 0
}

/**
 * jsdom has no layout. This lays the Settings › Agents headings out down a 4,000 px page in a
 * 900 px window, scrolled with `scrollPage`, and runs animation frames only when a scroll does.
 */
export function stubSubsectionLayout() {
  let frames: FrameRequestCallback[] = []
  const scrollIntoView = vi.fn()

  vi.stubGlobal('requestAnimationFrame', (frame: FrameRequestCallback) => frames.push(frame))
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => {
    frames[handle - 1] = () => undefined
  })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: WINDOW_HEIGHT })
  Object.defineProperty(document.documentElement, 'scrollHeight', {
    configurable: true,
    value: PAGE_HEIGHT,
  })
  setScrollY(0)
  Element.prototype.scrollIntoView = scrollIntoView
  const rectangles = vi
    .spyOn(Element.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: Element) {
      const top = headingTop(this)

      return DOMRect.fromRect({ x: 0, y: top, width: 0, height: 20 })
    })

  return {
    scrollIntoView,

    /** Scrolls the window to `y` and runs the frame the scroll asked for. */
    scrollPage(y: number) {
      act(() => {
        setScrollY(y)
        dispatchEvent(new Event('scroll'))
        const pending = frames
        frames = []
        for (const frame of pending) {
          frame(performance.now())
        }
      })
    },

    endScroll() {
      act(() => {
        dispatchEvent(new Event('scrollend'))
      })
    },

    restore() {
      rectangles.mockRestore()
      vi.unstubAllGlobals()
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
      delete (document.documentElement as { scrollHeight?: unknown }).scrollHeight
      setScrollY(0)
    },
  }
}
