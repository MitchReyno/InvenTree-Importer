import { renderHook } from '@testing-library/react'
import { expect, test } from 'vitest'
import type { OperatorReviewDto } from '@invimport/contracts'
import { useAcceptedOperatorReview } from './useAcceptedOperatorReview'

const review = (revision: string) => ({ revision }) as OperatorReviewDto

test('keeps the last accepted projection while a later read is unavailable, and takes newer ones', () => {
  const first = review('4')
  const { result, rerender } = renderHook(
    ({ current }: { current: OperatorReviewDto | undefined }) => useAcceptedOperatorReview(current),
    { initialProps: { current: undefined as OperatorReviewDto | undefined } },
  )
  expect(result.current).toBeUndefined()
  rerender({ current: first })
  expect(result.current).toBe(first)
  rerender({ current: undefined })
  expect(result.current).toBe(first)
  const second = review('5')
  rerender({ current: second })
  expect(result.current).toBe(second)
  rerender({ current: undefined })
  expect(result.current).toBe(second)
})
