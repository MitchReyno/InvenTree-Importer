import styled from 'styled-components'
import { media } from '../ui/media'
import { color, radius, size, space, typeVar } from '../../theme/generated/tokens'
import type { OperatorReviewDto } from '@invimport/contracts'
import {
  FILTER_LABELS,
  REVIEW_FILTERS,
  matchesFilter,
  type LotIds,
  type ReviewFilter,
} from '../../operator/review-model'

interface Props {
  review: OperatorReviewDto
  filter: ReviewFilter
  choose: (filter: ReviewFilter) => void
  questionLotIds?: LotIds
  /** False until Processing is read, when "Needs answer" cannot be counted yet. */
  questionsKnown?: boolean
}

function count(
  review: OperatorReviewDto,
  filter: ReviewFilter,
  questionLotIds: LotIds | undefined,
) {
  if (filter === 'retired') {
    return review.retired_lots.length
  }
  return review.lots.filter((lot) => matchesFilter(lot, filter, questionLotIds)).length
}

export function ReviewFilters({
  review,
  filter,
  choose,
  questionLotIds,
  questionsKnown = true,
}: Props) {
  return (
    <Chips role="group" aria-label="Filter lots" tabIndex={0}>
      {REVIEW_FILTERS.map((value) => (
        <Chip
          key={value}
          type="button"
          aria-pressed={filter === value}
          onClick={() => choose(value)}
        >
          {FILTER_LABELS[value]}{' '}
          <span>
            {value === 'needs_answer' && !questionsKnown
              ? '…'
              : count(review, value, questionLotIds)}
          </span>
        </Chip>
      ))}
    </Chips>
  )
}

const Chips = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space[3]};
  margin-bottom: ${space[6]};
  min-width: 0;
  ${media.compact} {
    flex-wrap: nowrap;
    max-width: 100%;
    overflow-x: auto;
    padding: ${space[1]};
    margin-bottom: ${space[4]};
  }
`
const Chip = styled.button`
  min-height: 36px;
  padding: ${space[3]} ${space[6]};
  border-radius: ${radius.pill};
  border: 1px solid ${color.lineStrong};
  background: ${color.surface};
  color: ${color.fg};
  cursor: pointer;
  span {
    color: ${color.muted};
    font-variant-numeric: tabular-nums;
  }
  ${media.compact} {
    flex: 0 0 auto;
    min-height: ${size.touch};
    white-space: nowrap;
  }
  &[aria-pressed='true'] {
    background: ${color.accentWeak};
    border-color: ${color.accent};
    color: ${color.accent};
    font-weight: ${typeVar.bodyStrong.weight};
  }
`
