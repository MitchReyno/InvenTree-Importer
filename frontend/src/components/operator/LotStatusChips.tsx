import styled from 'styled-components'
import { space } from '../../theme/generated/tokens'
import type { OperatorLotDto } from '@invimport/contracts'
import { blockingIssues, dismissedWarnings, openWarnings } from '../../operator/review-model'
import { Pill } from '../ui/Pill'

/** Compact lot state for queue rows and table cells. */
export function LotStatusChips({ lot }: { lot: OperatorLotDto }) {
  const blocking = blockingIssues(lot).length
  const warnings = openWarnings(lot).length
  const dismissed = dismissedWarnings(lot).length
  if (lot.excluded) {
    return (
      <Chips>
        <Pill status="excluded">Excluded</Pill>
      </Chips>
    )
  }
  return (
    <Chips>
      {lot.approved && <Pill tone="ok">Approved</Pill>}
      {lot.review_state === 'reviewed' && <Pill status="ready">Reviewed</Pill>}
      {lot.review_state === 'changed_after_review' && (
        <Pill status="warning">Changed after review</Pill>
      )}
      {blocking > 0 && <Pill status="blocking">{blocking} blocking</Pill>}
      {warnings > 0 && (
        <Pill status="warning">
          {warnings} warning{warnings === 1 ? '' : 's'}
        </Pill>
      )}
      {dismissed > 0 && <Pill tone="neutral">{dismissed} dismissed</Pill>}
      {lot.shared_lot_ids.length > 0 && (
        <Pill tone="acc">Shared Part ×{lot.shared_lot_ids.length + 1}</Pill>
      )}
      {lot.predecessor_lot_ids.length > 0 && <Pill tone="neutral">From lineage</Pill>}
    </Chips>
  )
}

const Chips = styled.span`
  display: flex;
  flex-wrap: wrap;
  gap: ${space[2]};
`
