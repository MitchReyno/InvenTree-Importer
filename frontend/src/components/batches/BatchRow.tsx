import styled from 'styled-components'
import { color, space, typeVar } from '../../theme/generated/tokens'
import { batchHref } from '../../navigation/batch-route'
import { media } from '../ui/media'
import { hoverTransition } from '../ui/motion'
import { RelativeTime } from '../ui/RelativeTime'
import { BatchThumbnail } from './BatchThumbnail'
import { AddedBar, BatchState, type InboxBatch } from './batchState'

/** One batch in the list: its photo, title, lots and last activity, and its state. */
export function BatchRow({ batch }: { batch: InboxBatch }) {
  return (
    <Link
      href={batchHref(batch.id, { tab: 'capture' })}
      aria-label={batch.title}
      aria-describedby={`${batch.id}-meta ${batch.id}-state`}
    >
      <BatchThumbnail batchId={batch.id} thumbnail={batch.workflow?.thumbnail} />
      <RowText>
        <strong aria-hidden="true">{batch.title}</strong>
        <Meta id={`${batch.id}-meta`}>
          {batch.archived ? 'Archived · ' : ''}
          {batch.workflow
            ? `${batch.workflow.lots} ${batch.workflow.lots === 1 ? 'lot' : 'lots'} · `
            : ''}
          <RelativeTime at={batch.updated_at} />
        </Meta>
      </RowText>
      <RowState id={`${batch.id}-state`}>
        <BatchState workflow={batch.workflow} />
        <AddedBar workflow={batch.workflow} />
      </RowState>
    </Link>
  )
}

/** The whole row opens the batch; its title names the link and the rest describes it. */
const Link = styled.a`
  --thumbnail-width: 72px;
  --thumbnail-height: 54px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: ${space[7]};
  padding: ${space[6]} ${space[7]};
  color: inherit;
  text-decoration: none;
  ${hoverTransition}
  &:hover {
    background: ${color.surface2};
  }
  strong {
    overflow-wrap: anywhere;
  }
  ${media.compact} {
    grid-template-columns: auto minmax(0, 1fr);
    > :last-child {
      grid-column: 2;
      justify-items: start;
    }
  }
`

const RowText = styled.span`
  display: grid;
  gap: ${space[1]};
  min-width: 0;
`

const RowState = styled.span`
  display: grid;
  justify-items: end;
  gap: ${space[3]};
`

const Meta = styled.span`
  font-size: ${typeVar.small.size};
  color: ${color.muted};
`
