import { describe, expect, it } from 'vitest'
import type {
  CaptureSnapshotDto,
  OperatorLotDto,
  OperatorReviewDto,
  ProcessingSnapshotDto,
} from '@invimport/contracts'
import {
  approvedLotIds,
  FILTER_LABELS,
  GROUP_LABELS,
  matchesFilter,
  openQuestionsByLot,
  queueGroup,
  REVIEW_FILTERS,
} from './review-model'

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

  it('offers a lot its oldest open question, whichever job asked it', () => {
    const asked = {
      jobs: [
        {
          stage: 'research',
          questions: [
            {
              id: 'q-new',
              state: 'open',
              spec: { subject_id: 'a' },
              asked_at: '2026-11-08T05:00:00Z',
            },
          ],
        },
        {
          stage: 'identifying',
          questions: [
            {
              id: 'q-old',
              state: 'open',
              spec: { subject_id: 'a' },
              asked_at: '2026-11-08T04:00:00Z',
            },
          ],
        },
      ],
    } as unknown as ProcessingSnapshotDto
    expect(openQuestionsByLot(asked, batch).get('a')).toMatchObject({
      id: 'q-old',
      step: 'examine',
    })
  })

  it('shows nothing before Processing is read', () => {
    expect(matchesFilter(lot('a'), 'needs_answer')).toBe(false)
    expect(openQuestionsByLot(undefined, batch).size).toBe(0)
  })
})

describe('excluded lots', () => {
  const excluded = {
    lot_id: 'x',
    review_state: 'needs_review',
    approved: false,
    issues: [{ code: 'lot_excluded', severity: 'blocking', message: 'Excluded: Bent leads.' }],
    excluded: { reason: 'Bent leads', at: '2026-11-08T05:00:00.000Z' },
  } as unknown as OperatorLotDto

  it('match only All and Excluded, and sit in their own group', () => {
    const matching = REVIEW_FILTERS.filter((filter) => matchesFilter(excluded, filter))
    expect(matching).toEqual(['all', 'excluded'])
    expect(FILTER_LABELS.excluded).toBe('Excluded')
    expect(queueGroup(excluded)).toBe('excluded')
    expect(GROUP_LABELS.excluded).toBe('Excluded')
  })
})
