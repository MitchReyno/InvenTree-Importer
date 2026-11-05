import styled from 'styled-components'
import { batchHref } from '../../navigation/batch-route'
import type { ProposedLot, ProposedLotState } from '../../processing/proposed-lots'
import { color, radius, space, type } from '../../theme/generated/tokens'
import { Pill, type PillTone } from '../ui/Pill'

const STATE: Record<ProposedLotState, { tone: PillTone; word: string }> = {
  approved: { tone: 'ok', word: 'Approved' },
  ready: { tone: 'ok', word: 'Ready' },
  to_review: { tone: 'neutral', word: 'To review' },
  changed: { tone: 'warn', word: 'Changed' },
  blocked: { tone: 'bad', word: 'Blocked' },
}

/** A read-only look at the lots; they are edited in Review. */
export function ProposedLotsGlance({ batchId, lots }: { batchId: string; lots: ProposedLot[] }) {
  return (
    <Glance aria-label={`Proposed lots, ${lots.length}`}>
      <Title>
        Proposed lots <Total>{lots.length}</Total>
      </Title>
      {lots.length === 0 ? (
        <Empty>No lots yet. Processing proposes them from the evidence.</Empty>
      ) : (
        <List>
          {lots.map((lot) => (
            <li key={lot.id}>
              <a href={lot.href}>{lot.label}</a>
              <Pill tone={STATE[lot.state].tone}>{STATE[lot.state].word}</Pill>
            </li>
          ))}
        </List>
      )}
      <Footer>
        A glance only. Lots are edited in Review.{' '}
        <a href={batchHref(batchId, { tab: 'review', view: 'lots' })}>Open Review</a>
      </Footer>
    </Glance>
  )
}

const Glance = styled.section`
  display: grid;
  gap: ${space[2]};
  padding: ${space['3-5']} ${space[4]};
  border: 1px solid ${color.line};
  border-radius: ${radius.card};
  background: ${color.surface};
`

const Title = styled.h2`
  display: flex;
  align-items: baseline;
  gap: ${space[2]};
  margin: 0;
  ${type.h2}
`

const Total = styled.span`
  font-size: 12.5px;
  font-weight: 400;
  color: ${color.muted};
`

const List = styled.ul`
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
  li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: ${space[2]};
    padding: ${space['1-5']} 0;
    border-top: 1px solid ${color.line};
  }
  li:first-child {
    border-top: 0;
  }
  a {
    min-width: 0;
    overflow: hidden;
    color: ${color.fg};
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`

const Empty = styled.p`
  margin: 0;
  color: ${color.muted};
`

const Footer = styled.p`
  margin: 0;
  font-size: 12.5px;
  color: ${color.muted};
  a {
    color: ${color.accent};
  }
`
