import { useState } from 'react'
import type { OperatorReviewDto } from '@invimport/contracts'

/**
 * The newest operator review projection accepted for this batch revision. A matching projection
 * keeps draft owners mounted when a later poll fails; callers still fence commands on `current`.
 */
export function useAcceptedOperatorReview(current: OperatorReviewDto | undefined) {
  const [accepted, setAccepted] = useState(current)
  if (current && current !== accepted) {
    setAccepted(current)
  }

  return current ?? accepted
}
