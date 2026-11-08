import { FilterChips } from '../ui/FilterChips'
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
    <FilterChips
      label="Filter lots"
      value={filter}
      onChange={(id) => choose(id as ReviewFilter)}
      options={REVIEW_FILTERS.map((value) => ({
        id: value,
        label: FILTER_LABELS[value],
        count:
          value === 'needs_answer' && !questionsKnown ? null : count(review, value, questionLotIds),
      }))}
    />
  )
}
