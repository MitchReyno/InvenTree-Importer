import { describe, expect, it } from 'vitest'
import type {
  CaptureSnapshotDto,
  OperatorLotDto,
  OperatorReviewDto,
  ProcessingSnapshotDto,
} from '@invimport/contracts'
import { approvedLotIds, matchesFilter, openQuestionsByLot } from './review-model'

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
        stage: 'identifying',
        questions: [
          { id: 'q-a', state: 'open', spec: { subject_id: 'a' } },
          { id: 'q-b', state: 'answered', spec: { subject_id: 'b' } },
          { id: 'q-part', state: 'open', spec: { subject_id: 'p' } },
          { id: 'q-none', state: 'open', spec: { subject_id: null } },
        ],
      },
    ],
  } as unknown as ProcessingSnapshotDto
  const batch = {
    lots: [
      { id: 'a', part_subject_id: null },
      { id: 'b', part_subject_id: null },
      { id: 'c', part_subject_id: 'p' },
      { id: 'd', part_subject_id: 'p' },
    ],
  } as unknown as CaptureSnapshotDto

  const lot = (lot_id: string) => ({ lot_id }) as OperatorLotDto

  it('shows lots with an open question of their own or on their Part', () => {
    const questions = openQuestionsByLot(processing, batch)

    expect([...questions.keys()]).toEqual(['a', 'c', 'd'])
    expect(questions.get('c')).toMatchObject({ id: 'q-part', step: 'examine' })
    expect(matchesFilter(lot('a'), 'needs_answer', questions)).toBe(true)
    expect(matchesFilter(lot('b'), 'needs_answer', questions)).toBe(false)
  })

  it('shows nothing before Processing is read', () => {
    expect(matchesFilter(lot('a'), 'needs_answer')).toBe(false)
    expect(openQuestionsByLot(undefined, batch).size).toBe(0)
  })
})
