import styled from 'styled-components'
import { color } from '../../theme/generated/tokens'
import type { CaptureSnapshotDto, OperatorReviewDto } from '@invimport/contracts'
import { Heading, Panel, Small } from '../ui/primitives'
import { StatusChip } from './StatusChip'

interface Props {
  batch: CaptureSnapshotDto
  review: OperatorReviewDto
}

function label(batch: CaptureSnapshotDto, id: string) {
  return batch.lots.find((lot) => lot.id === id)?.label ?? `Lot ${id.slice(0, 8)}`
}

/** Read-only lineage history; retired lots cannot be selected, edited or approved. */
export function RetiredLots({ batch, review }: Props) {
  return (
    <Panel aria-label="Retired lot history">
      <Heading>Retired lots</Heading>
      <Small>
        Split or merged before approval. Their notes and evidence stay with the history and are
        shown on successor lots.
      </Small>
      {!review.retired_lots.length && <Small>No lots have been split or merged.</Small>}
      <List>
        {review.retired_lots.map((lot) => (
          <li key={lot.lot_id}>
            <strong>{lot.label}</strong>{' '}
            <StatusChip $tone="neutral">{lot.action === 'split' ? 'Split' : 'Merged'}</StatusChip>
            <Small>
              Into {lot.successor_lot_ids.map((id) => label(batch, id)).join(', ')} · revision{' '}
              {lot.retired_revision}
            </Small>
          </li>
        ))}
      </List>
    </Panel>
  )
}

const List = styled.ul`
  display: grid;
  gap: 10px;
  padding: 0;
  list-style: none;
  li {
    padding: 10px;
    border: 1px dashed ${color.lineStrong};
    border-radius: 5px;
    background: ${color.surface2};
  }
`
