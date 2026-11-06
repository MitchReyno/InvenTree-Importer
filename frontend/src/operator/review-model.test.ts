import { describe, expect, it } from 'vitest'
import type { OperatorLotDto, OperatorReviewDto, ProcessingSnapshotDto } from '@invimport/contracts'
import { approvedLotIds, matchesFilter, openQuestionLotIds } from './review-model'

const review = (lots: [string, boolean][]) =>
  ({
    lots: lots.map(([lot_id, approved]) => ({ lot_id, approved })),
  }) as unknown as OperatorReviewDto

describe('approvedLotIds', () => {
  it('keeps lots the last accepted review added while the current one is unread', () => {
    expect([
      ...approvedLotIds(
        undefined,
        review([
          ['a', true],
          ['b', false],
        ]),
      ),
    ]).toEqual(['a'])
  })

  it('joins the current review with the accepted one', () => {
    expect([...approvedLotIds(review([['b', true]]), review([['a', true]]))].sort()).toEqual([
      'a',
      'b',
    ])
  })
})

describe('the Needs answer filter', () => {
  const processing = {
    jobs: [
      {
        questions: [
          { state: 'open', spec: { subject_id: 'a' } },
          { state: 'answered', spec: { subject_id: 'b' } },
          { state: 'open', spec: { subject_id: null } },
        ],
      },
    ],
  } as unknown as ProcessingSnapshotDto

  const lot = (lot_id: string) => ({ lot_id }) as OperatorLotDto

  it('shows lots with an open Processing question', () => {
    const ids = openQuestionLotIds(processing)

    expect([...ids]).toEqual(['a'])
    expect(matchesFilter(lot('a'), 'needs_answer', ids)).toBe(true)
    expect(matchesFilter(lot('b'), 'needs_answer', ids)).toBe(false)
  })

  it('shows nothing before Processing is read', () => {
    expect(matchesFilter(lot('a'), 'needs_answer')).toBe(false)
    expect(openQuestionLotIds(undefined).size).toBe(0)
  })
})
