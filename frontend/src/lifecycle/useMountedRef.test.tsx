import { renderHook } from '@testing-library/react'
import { StrictMode } from 'react'
import { expect, test } from 'vitest'
import { useMountedRef } from './useMountedRef'

test('is true while mounted, including after a StrictMode replay, and false once unmounted', () => {
  const { result, unmount } = renderHook(() => useMountedRef(), { wrapper: StrictMode })
  expect(result.current.current).toBe(true)
  const mounted = result.current
  unmount()
  expect(mounted.current).toBe(false)
})
