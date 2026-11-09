import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { useOnline } from './useOnline'

afterEach(() => {
  vi.restoreAllMocks()
})

test('follows the browser connection immediately', () => {
  const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  const { result } = renderHook(() => useOnline())
  expect(result.current).toBe(true)
  onLine.mockReturnValue(false)
  act(() => {
    dispatchEvent(new Event('offline'))
  })
  expect(result.current).toBe(false)
  onLine.mockReturnValue(true)
  act(() => {
    dispatchEvent(new Event('online'))
  })
  expect(result.current).toBe(true)
})
