import styled from 'styled-components'
import { color } from '../../theme/generated/tokens'
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
  questionLotIds?: ReadonlySet<string>
}

function count(
  review: OperatorReviewDto,
  filter: ReviewFilter,
  questionLotIds: ReadonlySet<string> | undefined,
) {
  if (filter === 'retired') {
    return review.retired_lots.length
  }
  return review.lots.filter((lot) => matchesFilter(lot, filter, questionLotIds)).length
}

export function ReviewFilters({ review, filter, choose, questionLotIds }: Props) {
  return (
    <Chips role="group" aria-label="Filter lots" tabIndex={0}>
      {REVIEW_FILTERS.map((value) => (
        <Chip
          key={value}
          type="button"
          aria-pressed={filter === value}
          onClick={() => choose(value)}
        >
          {FILTER_LABELS[value]} <span>{count(review, value, questionLotIds)}</span>
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
  min-width: 0;
  @media (max-width: 700px) {
    flex-wrap: nowrap;
    max-width: 100%;
    overflow-x: auto;
    padding: 2px;
    margin-bottom: 8px;
  }
`
const Chip = styled.button`
  min-height: 36px;
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid ${color.lineStrong};
  background: ${color.surface};
  color: ${color.fg};
  cursor: pointer;
  span {
    color: ${color.muted};
    font-variant-numeric: tabular-nums;
  }
  @media (max-width: 700px) {
    flex: 0 0 auto;
    min-height: 44px;
    white-space: nowrap;
  }
  &[aria-pressed='true'] {
    background: ${color.accentWeak};
    border-color: ${color.accent};
    color: ${color.accent};
    font-weight: 600;
  }
`
