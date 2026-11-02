import styled from 'styled-components'
import type { OperatorLotDto } from '@invimport/contracts'
import { blockingIssues, dismissedWarnings, openWarnings } from '../../operator/review-model'
import { StatusChip } from './StatusChip'

/** Compact lot state for queue rows and table cells. */
export function LotStatusChips({ lot }: { lot: OperatorLotDto }) {
  const blocking = blockingIssues(lot).length
  const warnings = openWarnings(lot).length
  const dismissed = dismissedWarnings(lot).length
  return (
    <Chips>
      {lot.approved && <StatusChip $tone="green">Approved</StatusChip>}
      {lot.review_state === 'reviewed' && <StatusChip $tone="green">✓ Reviewed</StatusChip>}
      {lot.review_state === 'changed_after_review' && (
        <StatusChip $tone="amber">! Changed after review</StatusChip>
      )}
      {blocking > 0 && <StatusChip $tone="red">× {blocking} blocking</StatusChip>}
      {warnings > 0 && (
        <StatusChip $tone="amber">
          ! {warnings} warning{warnings === 1 ? '' : 's'}
        </StatusChip>
      )}
      {dismissed > 0 && <StatusChip $tone="neutral">{dismissed} dismissed</StatusChip>}
      {lot.shared_lot_ids.length > 0 && (
        <StatusChip $tone="blue">Shared Part ×{lot.shared_lot_ids.length + 1}</StatusChip>
      )}
      {lot.predecessor_lot_ids.length > 0 && <StatusChip $tone="neutral">From lineage</StatusChip>}
    </Chips>
  )
}

const Chips = styled.span`
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
`
