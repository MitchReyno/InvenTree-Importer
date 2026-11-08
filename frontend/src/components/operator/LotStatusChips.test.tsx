import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import type { OperatorLotDto } from '@invimport/contracts'
import { LotStatusChips } from './LotStatusChips'

const lot = (overrides: Partial<OperatorLotDto>) =>
  ({
    approved: false,
    review_state: 'reviewed',
    issues: [],
    shared_lot_ids: [],
    predecessor_lot_ids: [],
    ...overrides,
  }) as unknown as OperatorLotDto

it('shows lot state as the shared Pill, with each status glyph drawn once', () => {
  render(
    <LotStatusChips
      lot={lot({
        issues: [{ id: 'i', severity: 'blocking', disposition: null }] as never,
      })}
    />,
  )
  const reviewed = screen.getByText('Reviewed').closest('[data-tone]')
  expect(reviewed).toHaveAttribute('data-tone', 'ok')
  expect(reviewed).toHaveTextContent('✓Reviewed')
  expect(screen.getByText('1 blocking').closest('[data-tone]')).toHaveAttribute('data-tone', 'bad')
})

it('an excluded lot shows Excluded alone, not the block its exclusion raises', () => {
  render(
    <LotStatusChips
      lot={lot({
        review_state: 'needs_review',
        issues: [
          { id: 'i', code: 'lot_excluded', severity: 'blocking', disposition: null },
        ] as never,
        excluded: { reason: 'Bent leads', at: '2026-11-08T05:00:00.000Z' },
      })}
    />,
  )
  expect(screen.getByText('Excluded')).toBeInTheDocument()
  expect(screen.queryByText('1 blocking')).toBeNull()
})
