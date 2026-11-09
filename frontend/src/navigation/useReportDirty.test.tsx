import { renderHook } from '@testing-library/react'
import { StrictMode } from 'react'
import { expect, test, vi } from 'vitest'
import { useReportDirty } from './useReportDirty'

test('releases the guard when the editor unmounts', () => {
  const report = vi.fn()
  const { rerender, unmount } = renderHook(({ dirty }) => useReportDirty(dirty, report), {
    initialProps: { dirty: false },
  })
  rerender({ dirty: true })
  unmount()
  expect(report).toHaveBeenLastCalledWith(false)
})

test('a replaced callback hears the current state, and the old one hears no clean', () => {
  const first = vi.fn()
  const second = vi.fn()
  const { rerender, unmount } = renderHook(({ report }) => useReportDirty(true, report), {
    initialProps: { report: first },
  })
  rerender({ report: second })
  expect(first.mock.calls).toEqual([[true]])
  expect(second.mock.calls).toEqual([[true]])
  unmount()
  expect(second).toHaveBeenLastCalledWith(false)
  expect(first).not.toHaveBeenCalledWith(false)
})

test('a StrictMode replay ends with the current state', () => {
  const report = vi.fn()
  renderHook(() => useReportDirty(true, report), { wrapper: StrictMode })
  expect(report).toHaveBeenLastCalledWith(true)
})

test('an absent callback is ignored', () => {
  const { unmount } = renderHook(() => useReportDirty(true, undefined))
  expect(() => unmount()).not.toThrow()
})
