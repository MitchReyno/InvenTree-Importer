import { renderHook } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { useOnForeground } from './useOnForeground'

test('runs the latest callback on focus, reconnection and visibility', () => {
  const first = vi.fn()
  const second = vi.fn()
  const { rerender } = renderHook(({ callback }) => useOnForeground(callback), {
    initialProps: { callback: first },
  })
  rerender({ callback: second })
  dispatchEvent(new Event('focus'))
  dispatchEvent(new Event('online'))
  document.dispatchEvent(new Event('visibilitychange'))
  expect(first).not.toHaveBeenCalled()
  expect(second).toHaveBeenCalledTimes(3)
})

test('ignores a visibility change that hides the page', () => {
  const callback = vi.fn()
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  renderHook(() => useOnForeground(callback))
  document.dispatchEvent(new Event('visibilitychange'))
  dispatchEvent(new Event('focus'))
  expect(callback).not.toHaveBeenCalled()
  visibility.mockReturnValue('visible')
  document.dispatchEvent(new Event('visibilitychange'))
  expect(callback).toHaveBeenCalledTimes(1)
  visibility.mockRestore()
})

test('stops listening after unmount', () => {
  const callback = vi.fn()
  const { unmount } = renderHook(() => useOnForeground(callback))
  unmount()
  dispatchEvent(new Event('focus'))
  expect(callback).not.toHaveBeenCalled()
})
