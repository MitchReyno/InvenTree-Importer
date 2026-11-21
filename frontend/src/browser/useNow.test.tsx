import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useNow } from './useNow'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

test('advances on each interval', () => {
  const { result } = renderHook(() => useNow(1000))
  const start = result.current
  act(() => {
    vi.advanceTimersByTime(1000)
  })
  expect(result.current).toBe(start + 1000)
})

test('advances at once when the page returns to the foreground', () => {
  const { result } = renderHook(() => useNow(60_000))
  const start = result.current
  vi.setSystemTime(start + 90_000)
  act(() => {
    dispatchEvent(new Event('focus'))
  })
  expect(result.current).toBe(start + 90_000)
  vi.setSystemTime(start + 120_000)
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
  expect(result.current).toBe(start + 120_000)
})
