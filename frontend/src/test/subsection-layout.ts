import { act } from '@testing-library/react'
import { vi } from 'vitest'
import type { AgentSubsectionId } from '#/navigation/app-route'
import { subsectionHeadingId } from '#/components/settings/agents/AgentSubsection'

export const WINDOW_HEIGHT = 900
export const PAGE_HEIGHT = 4000
export const PAGE_END = PAGE_HEIGHT - WINDOW_HEIGHT

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

/** Puts back an own property as it was, or removes it if the object had none. */
function restoreProperty(target: object, name: string, original: PropertyDescriptor | undefined) {
  if (original) {
    Object.defineProperty(target, name, original)
  } else {
    delete (target as Record<string, unknown>)[name]
  }
}

/**
 * jsdom has no layout. This lays the Settings › Agents headings out down a 4,000 px page in a
 * 900 px window, scrolled with `scrollPage`, and runs animation frames only when asked to.
 * `restore` puts back only what it changed.
 */
export function stubSubsectionLayout() {
  let frames: FrameRequestCallback[] = []
  const scrollIntoView = vi.fn()
  const original = {
    requestAnimationFrame: window.requestAnimationFrame,
    cancelAnimationFrame: window.cancelAnimationFrame,
    innerHeight: Object.getOwnPropertyDescriptor(window, 'innerHeight'),
    scrollY: Object.getOwnPropertyDescriptor(window, 'scrollY'),
    scrollHeight: Object.getOwnPropertyDescriptor(document.documentElement, 'scrollHeight'),
    scrollIntoView: Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView'),
  }

  window.requestAnimationFrame = (frame: FrameRequestCallback) => frames.push(frame)
  window.cancelAnimationFrame = (handle: number) => {
    frames[handle - 1] = () => undefined
  }
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

  function flushFrames() {
    const pending = frames
    frames = []
    for (const frame of pending) {
      frame(performance.now())
    }
  }

  /** Scrolls the window to `y`, as any scroll does, without running the frame it asks for. */
  function scrollWithoutFrame(y: number) {
    setScrollY(y)
    dispatchEvent(new Event('scroll'))
  }

  return {
    scrollIntoView,
    scrollWithoutFrame,

    /** Runs the animation frames requested so far. */
    flushFrames() {
      act(flushFrames)
    },

    /** Scrolls the window to `y` and runs the frame the scroll asked for. */
    scrollPage(y: number) {
      act(() => {
        scrollWithoutFrame(y)
        flushFrames()
      })
    },

    endScroll() {
      act(() => {
        dispatchEvent(new Event('scrollend'))
      })
    },

    restore() {
      rectangles.mockRestore()
      window.requestAnimationFrame = original.requestAnimationFrame
      window.cancelAnimationFrame = original.cancelAnimationFrame
      restoreProperty(window, 'innerHeight', original.innerHeight)
      restoreProperty(window, 'scrollY', original.scrollY)
      restoreProperty(document.documentElement, 'scrollHeight', original.scrollHeight)
      restoreProperty(Element.prototype, 'scrollIntoView', original.scrollIntoView)
    },
  }
}
