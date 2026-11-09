import { useState } from 'react'
import type { OperatorReviewDto } from '@invimport/contracts'

/**
 * The newest operator review projection seen since mount, kept when a later poll fails so draft
 * owners stay mounted. It is not checked against a batch revision: callers whose revision can
 * change compare it themselves, and still fence commands on `current`.
 */
export function useAcceptedOperatorReview(current: OperatorReviewDto | undefined) {
  const [accepted, setAccepted] = useState(current)
  if (current && current !== accepted) {
    setAccepted(current)
  }

  return current ?? accepted
}
