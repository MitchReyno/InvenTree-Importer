import { renderHook } from '@testing-library/react'
import { StrictMode } from 'react'
import { expect, test, vi } from 'vitest'
import { useSaveQueue } from './useSaveQueue'

test('the mounted queue still dispatches after StrictMode replays its effects', () => {
  const send = vi.fn(() => new Promise<{ revision: string }>(() => undefined))
  const { result } = renderHook(() => useSaveQueue('1'), { wrapper: StrictMode })
  const [queue] = result.current
  queue.register('settings', { send, revisionOf: (value) => value.revision }, 'a')
  queue.update('settings', 'b', { immediate: true })
  expect(send).toHaveBeenCalledWith('b', '1', expect.any(String))
})

test('a genuinely unmounted queue never dispatches', () => {
  const send = vi.fn(() => new Promise<{ revision: string }>(() => undefined))
  const { result, unmount } = renderHook(() => useSaveQueue('1'))
  const [queue] = result.current
  queue.register('settings', { send, revisionOf: (value) => value.revision }, 'a')
  unmount()
  queue.update('settings', 'b', { immediate: true })
  expect(send).not.toHaveBeenCalled()
})
