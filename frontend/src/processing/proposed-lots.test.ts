import { describe, expect, it } from 'vitest'
import type { CaptureSnapshotDto, OperatorReviewDto } from '@invimport/contracts'
import { proposedLots } from './proposed-lots'

const batchId = 'b0000000-0000-4000-8000-000000000001'

const lot = (n: number) => `a0000000-0000-4000-8000-00000000000${n}`

const batch = {
  id: batchId,
  lots: [1, 2, 3, 4, 5, 6].map((n) => ({ id: lot(n), label: `Lot ${n}` })),
} as unknown as CaptureSnapshotDto

function reviewLot(n: number, state: string, blocking = false) {
  return {
    lot_id: lot(n),
    review_state: state,
    issues: blocking ? [{ severity: 'blocking', disposition: null }] : [],
  }
}

const review = {
  lots: [
    reviewLot(1, 'reviewed'),
    reviewLot(2, 'unreviewed'),
    reviewLot(3, 'changed_after_review'),
    reviewLot(4, 'reviewed', true),
    { ...reviewLot(6, 'unreviewed', true), approved: true },
  ],
} as unknown as OperatorReviewDto

describe('proposedLots', () => {
  it('gives each active lot a state in words and a Review link', () => {
    expect(proposedLots(batch, review, new Set([lot(5)]))).toEqual([
      { id: lot(1), label: 'Lot 1', state: 'ready', href: `#${batchId}/review/lots/${lot(1)}` },
      { id: lot(2), label: 'Lot 2', state: 'to_review', href: `#${batchId}/review/lots/${lot(2)}` },
      { id: lot(3), label: 'Lot 3', state: 'changed', href: `#${batchId}/review/lots/${lot(3)}` },
      { id: lot(4), label: 'Lot 4', state: 'blocked', href: `#${batchId}/review/lots/${lot(4)}` },
      { id: lot(6), label: 'Lot 6', state: 'approved', href: `#${batchId}/review/lots/${lot(6)}` },
    ])
  })

  it('reads every lot as to review before the review projection loads', () => {
    expect(proposedLots(batch, undefined, new Set()).map((item) => item.state)).toEqual([
      'to_review',
      'to_review',
      'to_review',
      'to_review',
      'to_review',
      'to_review',
    ])
  })
})

describe('proposedLots for lead-session lots', () => {
  it('carries origin, edited state, observation crops and open suggestions', () => {
    const batch = {
      id: 'b',
      lots: [
        {
          id: 'l1',
          label: 'LED 0603 red',
          origin: 'agent',
          agent_session_id: 's',
          evidence_observation_ids: ['o1', 'o2'],
        },
        { id: 'l2', label: 'Packet A', operator_edited: true },
      ],
      evidence_observations: [
        { id: 'o1', region: { kind: 'pixels' }, suggested_lot_ids: [] },
        { id: 'o2', region: { kind: 'lines' }, suggested_lot_ids: [] },
        { id: 'o3', region: { kind: 'pixels' }, suggested_lot_ids: ['l1'] },
      ],
    } as unknown as Parameters<typeof proposedLots>[0]
    const [led, packet] = proposedLots(batch, undefined, new Set())
    expect(led).toMatchObject({ origin: 'agent', edited: false, suggestions: 1 })
    expect(led.crops).toEqual(['/api/v1/batches/b/media/observations/o1/crop'])
    expect(packet).toEqual({
      id: 'l2',
      label: 'Packet A',
      state: 'to_review',
      href: '#b/review/lots/l2',
    })
  })
})

it('leaves out lots the snapshot marks retired', () => {
  const batch = {
    id: 'b',
    lots: [
      { id: 'l1', label: 'Kept' },
      { id: 'l2', label: 'Merged away', retired: true },
    ],
  } as unknown as Parameters<typeof proposedLots>[0]
  expect(proposedLots(batch, undefined, new Set()).map((lot) => lot.label)).toEqual(['Kept'])
})
