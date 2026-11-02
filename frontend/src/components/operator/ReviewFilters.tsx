import styled from 'styled-components'
import type { OperatorReviewDto } from '@invimport/contracts'
import {
  FILTER_LABELS,
  REVIEW_FILTERS,
  matchesFilter,
  type ReviewFilter,
} from '../../operator/review-model'

interface Props {
  review: OperatorReviewDto
  filter: ReviewFilter
  choose: (filter: ReviewFilter) => void
}

function count(review: OperatorReviewDto, filter: ReviewFilter) {
  if (filter === 'retired') {
    return review.retired_lots.length
  }
  return review.lots.filter((lot) => matchesFilter(lot, filter)).length
}

export function ReviewFilters({ review, filter, choose }: Props) {
  return (
    <Chips role="group" aria-label="Filter lots">
      {REVIEW_FILTERS.map((value) => (
        <Chip
          key={value}
          type="button"
          aria-pressed={filter === value}
          onClick={() => choose(value)}
        >
          {FILTER_LABELS[value]} <span>{count(review, value)}</span>
        </Chip>
      ))}
    </Chips>
  )
}

const Chips = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
`
const Chip = styled.button`
  min-height: 36px;
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid #c8d3e1;
  background: #fff;
  color: #3c4b61;
  cursor: pointer;
  span {
    color: #526179;
    font-variant-numeric: tabular-nums;
  }
  &[aria-pressed='true'] {
    background: #e0eafa;
    border-color: #266ac5;
    color: #164a93;
    font-weight: 600;
  }
`
