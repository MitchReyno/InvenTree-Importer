import styled from 'styled-components'
import { batchHref } from '../../navigation/batch-route'
import type { ProposedLot, ProposedLotState } from '../../processing/proposed-lots'
import { color, radius, size, space, type, typeVar } from '../../theme/generated/tokens'
import { media } from '../ui/media'
import { linkTouchArea } from '../ui/primitives'
import { Pill, type PillTone } from '../ui/Pill'

const STATE: Record<ProposedLotState, { tone: PillTone; word: string }> = {
  approved: { tone: 'ok', word: 'Approved' },
  ready: { tone: 'ok', word: 'Ready' },
  to_review: { tone: 'neutral', word: 'To review' },
  changed: { tone: 'warn', word: 'Changed' },
  blocked: { tone: 'bad', word: 'Blocked' },
}

/**
 * A read-only look at the lots; they are edited in Review. Lots the Examine lead session forms
 * appear here as it works, with their crops and its latest status line.
 */
export function ProposedLotsGlance({
  batchId,
  lots,
  leadStatus,
}: {
  batchId: string
  lots: ProposedLot[]
  leadStatus?: string
}) {
  return (
    <Glance aria-label={`Proposed lots, ${lots.length}`}>
      <Title>
        Proposed lots <Total>{lots.length}</Total>
      </Title>
      {leadStatus && <Lead role="status">Examine · {leadStatus}</Lead>}
      {lots.length === 0 ? (
        <Empty>No lots yet. Processing proposes them from the evidence.</Empty>
      ) : (
        <List>
          {lots.map((lot) => (
            <li key={lot.id} aria-label={lot.label}>
              <Row>
                <a href={lot.href}>{lot.label}</a>
                <Pills>
                  {lot.origin === 'agent' &&
                    (lot.edited ? (
                      <Pill tone="neutral">Edited</Pill>
                    ) : (
                      <Pill tone="acc">AI-proposed</Pill>
                    ))}
                  <Pill tone={STATE[lot.state].tone}>{STATE[lot.state].word}</Pill>
                </Pills>
              </Row>
              {lot.status && <Small>{lot.status}</Small>}
              {Boolean(lot.crops?.length || lot.suggestions) && (
                <Detail>
                  {lot.crops?.slice(0, 4).map((src, index) => (
                    <Crop key={src} src={src} alt={`Observation ${index + 1} of ${lot.label}`} />
                  ))}
                  {lot.suggestions ? (
                    <Small>
                      {lot.suggestions} suggestion{lot.suggestions === 1 ? '' : 's'}
                    </Small>
                  ) : null}
                </Detail>
              )}
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
  gap: ${space[4]};
  padding: ${space[7]} ${space[8]};
  border: 1px solid ${color.line};
  border-radius: ${radius.card};
  background: ${color.surface};
`

const Title = styled.h2`
  display: flex;
  align-items: baseline;
  gap: ${space[4]};
  margin: 0;
  ${type.h2}
`

const Total = styled.span`
  font-size: ${typeVar.small.size};
  font-weight: ${typeVar.small.weight};
  color: ${color.muted};
`

const List = styled.ul`
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
  li {
    display: grid;
    gap: ${space[2]};
    padding: ${space[3]} 0;
    border-top: 1px solid ${color.line};
  }
  li:first-child {
    border-top: 0;
  }
  a {
    min-width: 0;
    overflow: hidden;
    touch-action: manipulation;
    color: ${color.fg};
    font-weight: ${typeVar.bodyStrong.weight};
    text-overflow: ellipsis;
    white-space: nowrap;
    ${media.compact} {
      display: block;
      line-height: ${size.touch};
    }
  }
`

const Lead = styled.p`
  margin: 0;
  font-size: ${typeVar.small.size};
  color: ${color.muted};
`

const Row = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${space[4]};
  min-width: 0;
`

const Pills = styled.span`
  display: inline-flex;
  flex-shrink: 0;
  gap: ${space[2]};
`

const Detail = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[2]};
`

const Crop = styled.img`
  width: 40px;
  height: 40px;
  object-fit: cover;
  border: 1px solid ${color.line};
  border-radius: ${radius.card};
  background: ${color.surface};
`

const Small = styled.span`
  font-size: ${typeVar.small.size};
  color: ${color.muted};
`

const Empty = styled.p`
  margin: 0;
  color: ${color.muted};
`

const Footer = styled.p`
  margin: 0;
  font-size: ${typeVar.small.size};
  color: ${color.muted};
  a {
    color: ${color.accent};
    touch-action: manipulation;
    ${linkTouchArea}
  }
`
