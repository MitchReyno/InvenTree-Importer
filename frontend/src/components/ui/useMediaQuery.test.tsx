import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { useMediaQuery } from './useMediaQuery'

afterEach(() => {
  vi.unstubAllGlobals()
})

test('subscribes once per query and follows its changes', () => {
  let matches = false
  const listeners = new Set<() => void>()
  const add = vi.fn((_type: string, listener: () => void) => listeners.add(listener))
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      get matches() {
        return matches
      },
      addEventListener: add,
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    })),
  )
  const { result, rerender } = renderHook(({ rule }) => useMediaQuery(rule), {
    initialProps: { rule: '@media (min-width: 900px)' },
  })
  expect(result.current).toBe(false)
  rerender({ rule: '@media (min-width: 900px)' })
  rerender({ rule: '@media (min-width: 900px)' })
  expect(add).toHaveBeenCalledOnce()
  matches = true
  act(() => listeners.forEach((listener) => listener()))
  expect(result.current).toBe(true)
})
