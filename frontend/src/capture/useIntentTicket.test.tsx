import { renderHook } from '@testing-library/react'
import { expect, test } from 'vitest'
import { useIntentTicket } from './useIntentTicket'

test('only the newest ticket of a mounted field may apply its result', () => {
  const { result, unmount } = renderHook(() => useIntentTicket())
  const first = result.current.take()
  const second = result.current.take()
  expect(result.current.isCurrent(first)).toBe(false)
  expect(result.current.isCurrent(second)).toBe(true)
  const { isCurrent } = result.current
  unmount()
  expect(isCurrent(second)).toBe(false)
})
