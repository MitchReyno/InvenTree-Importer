import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { useDevicePixelRatio } from './useDevicePixelRatio'

afterEach(() => {
  vi.unstubAllGlobals()
})

test('follows each change of pixel ratio, re-arming the resolution query every time', () => {
  const queries: { media: string; listeners: Set<() => void> }[] = []
  vi.stubGlobal('devicePixelRatio', 1)
  vi.stubGlobal(
    'matchMedia',
    vi.fn((media: string) => {
      const query = { media, listeners: new Set<() => void>() }
      queries.push(query)
      return {
        media,
        addEventListener: (_type: string, listener: () => void) => query.listeners.add(listener),
        removeEventListener: (_type: string, listener: () => void) =>
          query.listeners.delete(listener),
      }
    }),
  )
  const { result } = renderHook(() => useDevicePixelRatio())
  expect(result.current).toBe(1)

  function moveTo(ratio: number) {
    vi.stubGlobal('devicePixelRatio', ratio)
    const armed = queries.filter((query) => query.listeners.size > 0)
    expect(armed).toHaveLength(1)
    act(() => armed[0].listeners.forEach((listener) => listener()))
  }

  moveTo(2)
  expect(result.current).toBe(2)
  expect(queries.at(-1)?.media).toBe('(resolution: 2dppx)')
  moveTo(1.5)
  expect(result.current).toBe(1.5)
})
