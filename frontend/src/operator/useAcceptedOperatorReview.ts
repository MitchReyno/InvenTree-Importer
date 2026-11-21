import { useState } from 'react'
import type { OperatorReviewDto } from '@invimport/contracts'

/**
 * The newest operator review projection seen since mount, kept when a later poll fails so draft
 * owners stay mounted. It may belong to an earlier batch revision: each caller decides where that
 * is acceptable, and fences commands on `current`.
 */
export function useAcceptedOperatorReview(current: OperatorReviewDto | undefined) {
  const [accepted, setAccepted] = useState(current)
  if (current && current !== accepted) {
    setAccepted(current)
  }

  return current ?? accepted
}
