import { describe, expect, it } from 'vitest'
import type { OperatorReviewDto } from '@invimport/contracts'
import { approvedLotIds } from './review-model'

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
