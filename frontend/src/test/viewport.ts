import { vi } from 'vitest'

/**
 * jsdom has no `matchMedia`. This one matches every `max-width` query, as a phone does, until
 * the returned restore runs.
 */
export function stubPhoneViewport() {
  window.matchMedia = vi.fn(
    (query: string) =>
      ({
        matches: query.includes('max-width'),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }) as unknown as MediaQueryList,
  )

  return () => {
    delete (window as { matchMedia?: unknown }).matchMedia
  }
}

type Observed = { element: Element; callback: IntersectionObserverCallback }

/**
 * Replaces `IntersectionObserver` with one the test drives: `scroll(false)` reports every observed
 * element out of view, `scroll(true)` back in view.
 */
export function stubIntersectionObserver() {
  const observed: Observed[] = []

  class FakeObserver {
    private readonly callback: IntersectionObserverCallback

    constructor(callback: IntersectionObserverCallback) {
      this.callback = callback
    }

    observe(element: Element) {
      observed.push({ element, callback: this.callback })
    }

    disconnect() {
      const kept = observed.filter((entry) => entry.callback !== this.callback)
      observed.splice(0, observed.length, ...kept)
    }

    unobserve() {}

    takeRecords() {
      return []
    }
  }

  vi.stubGlobal('IntersectionObserver', FakeObserver)

  return {
    observed,
    scroll(inView: boolean) {
      for (const { element, callback } of [...observed]) {
        callback(
          [{ isIntersecting: inView, target: element } as IntersectionObserverEntry],
          {} as IntersectionObserver,
        )
      }
    },
  }
}
