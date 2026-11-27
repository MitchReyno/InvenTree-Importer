import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { useHashRoute } from './useHashRoute'

afterEach(() => {
  history.replaceState(null, '', '#')
})

function navigate(hash: string) {
  act(() => {
    history.replaceState(null, '', hash)
    dispatchEvent(new HashChangeEvent('hashchange'))
  })
}

test('follows hash changes without the marker', () => {
  history.replaceState(null, '', '#batch/capture')
  const { result } = renderHook(() => useHashRoute())
  expect(result.current).toBe('batch/capture')
  navigate('#batch/review')
  expect(result.current).toBe('batch/review')
})

test('shows the fallback while the hash is empty', () => {
  history.replaceState(null, '', '#')
  const { result } = renderHook(() => useHashRoute('batch/changes'))
  expect(result.current).toBe('batch/changes')
  navigate('#batch/review')
  expect(result.current).toBe('batch/review')
})
