import { act, renderHook } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { useDirtySources } from './useDirtySources'

test('a replaced parent callback hears the current dirty state, not a false clean', () => {
  const first = vi.fn()
  const second = vi.fn()
  const { result, rerender, unmount } = renderHook(({ notify }) => useDirtySources(notify), {
    initialProps: { notify: first },
  })
  act(() => result.current.forSource('upload')(true))
  rerender({ notify: second })
  expect(first.mock.calls).toEqual([[false], [true]])
  expect(second).toHaveBeenLastCalledWith(true)
  expect(result.current.isDirty('upload')).toBe(true)
  unmount()
  expect(second).toHaveBeenLastCalledWith(false)
})
