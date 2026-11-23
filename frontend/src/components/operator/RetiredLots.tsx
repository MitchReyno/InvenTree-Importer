import styled from 'styled-components'
import { color, radius, space } from '#/theme/generated/tokens'
import type { CaptureSnapshotDto, OperatorReviewDto } from '@invimport/contracts'
import { DebugDetails, Heading, HelpButton, Panel, Small, Pill } from '#/components/ui'

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
      <TitleRow>
        <Heading>Retired lots</Heading>
        <HelpButton
          label="About retired lots"
          explanation="These lots were split or merged before approval. Their notes and evidence stay in the history and show on the lots that replaced them."
        />
      </TitleRow>
      {!review.retired_lots.length && <Small>No lots have been split or merged.</Small>}
      <List>
        {review.retired_lots.map((lot) => (
          <li key={lot.lot_id}>
            <strong>{lot.label}</strong>{' '}
            <Pill tone="neutral">{lot.action === 'split' ? 'Split' : 'Merged'}</Pill>
            <Small>Into {lot.successor_lot_ids.map((id) => label(batch, id)).join(', ')}</Small>
            <DebugDetails
              label="Retired lot"
              rows={[
                { label: 'Lot', value: lot.lot_id },
                { label: 'Retired revision', value: lot.retired_revision },
              ]}
            />
          </li>
        ))}
      </List>
    </Panel>
  )
}

const TitleRow = styled.div`
  display: flex;
  align-items: center;
  gap: ${space[3]};
  margin-bottom: ${space[6]};
  ${Heading} {
    margin: 0;
  }
`

const List = styled.ul`
  display: grid;
  gap: ${space[5]};
  padding: 0;
  list-style: none;
  li {
    padding: ${space[5]};
    border: 1px dashed ${color.lineStrong};
    border-radius: ${radius.card};
    background: ${color.surface2};
  }
`
