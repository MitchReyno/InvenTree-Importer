import styled from 'styled-components'
import { batchHref } from '../../navigation/batch-route'
import type { ProposedLot, ProposedLotState } from '../../processing/proposed-lots'
import { color, radius, space, type, typeVar } from '../../theme/generated/tokens'
import { Button } from '../ui/Button'
import { Spinner } from '../ui/Loading'
import { Count, Pill, type PillTone } from '../ui/Pill'

const STATE: Record<ProposedLotState, { tone: PillTone; word: string }> = {
  approved: { tone: 'ok', word: 'Approved' },
  ready: { tone: 'ok', word: 'Ready' },
  to_review: { tone: 'neutral', word: 'To review' },
  changed: { tone: 'warn', word: 'Changed' },
  blocked: { tone: 'bad', word: 'Blocked' },
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

function meta(lot: ProposedLot) {
  const parts = []
  if (lot.crops?.length) {
    parts.push(plural(lot.crops.length, 'observation'))
  }
  if (lot.suggestions) {
    parts.push(plural(lot.suggestions, 'suggestion'))
  }
  return parts.join(' · ')
}

/**
 * A read-only look at the lots; they are edited in Review. Lots the Examine lead session forms
 * appear here as it works, with their first crop and its latest status line.
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
      <Head>
        <Title>
          Proposed lots <Count value={lots.length} />
        </Title>
        {leadStatus && (
          <Lead role="status">
            <Spinner />
            Examine · {leadStatus}
          </Lead>
        )}
      </Head>
      {lots.length === 0 ? (
        <Empty>No lots yet. Processing proposes them from the evidence.</Empty>
      ) : (
        <List>
          {lots.map((lot) => {
            const detail = meta(lot)
            return (
              <Row key={lot.id} aria-label={lot.label}>
                <Thumb>
                  {lot.crops?.[0] ? (
                    <img src={lot.crops[0]} alt={lot.label} />
                  ) : (
                    <span aria-hidden="true">▧</span>
                  )}
                </Thumb>
                <Body>
                  <LotLink href={lot.href}>{lot.label}</LotLink>
                  {detail && <Small>{detail}</Small>}
                  {lot.status && <Small>{lot.status}</Small>}
                </Body>
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
            )
          })}
        </List>
      )}
      <Footer>
        <span>A glance only. Lots are edited in Review.</span>
        <Button as="a" size="sm" href={batchHref(batchId, { tab: 'review', view: 'map' })}>
          See the map in Review
        </Button>
      </Footer>
    </Glance>
  )
}

const Glance = styled.section`
  border: 1px solid ${color.line};
  border-radius: ${radius.card};
  background: ${color.surface};
  min-width: 0;
`

const Head = styled.div`
  display: grid;
  gap: ${space[3]};
  padding: ${space[7]} ${space[8]};
`

const Title = styled.h2`
  display: flex;
  align-items: center;
  gap: ${space[4]};
  margin: 0;
  ${type.h2}
`

const Lead = styled.p`
  display: flex;
  align-items: center;
  gap: ${space[3]};
  margin: 0;
  ${type.small}
  color: ${color.muted};
  span:first-child {
    color: ${color.accent};
  }
`

const List = styled.ul`
  margin: 0;
  padding: 0;
  list-style: none;
`

// The lot's link covers its row, so the whole row is one target.
const Row = styled.li`
  position: relative;
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) auto;
  gap: ${space[5]};
  align-items: center;
  padding: ${space[5]} ${space[8]};
  border-top: 1px solid ${color.line};
`

const Thumb = styled.span`
  display: grid;
  place-items: center;
  /* literal-allowed: the canvas's 4:3 row thumbnail; no thumbnail size token */
  width: 44px;
  height: 34px;
  overflow: hidden;
  border: 1px solid ${color.line};
  border-radius: ${radius.thumb};
  background: ${color.photoStage};
  color: ${color.photoFg};
  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
`

const Body = styled.div`
  display: grid;
  min-width: 0;
`

const LotLink = styled.a`
  overflow: hidden;
  color: ${color.fg};
  font-size: ${typeVar.small.size};
  font-weight: ${typeVar.bodyStrong.weight};
  text-decoration: none;
  text-overflow: ellipsis;
  white-space: nowrap;
  touch-action: manipulation;
  &::after {
    content: '';
    position: absolute;
    inset: 0;
  }
  &:hover {
    text-decoration: underline;
  }
`

const Pills = styled.span`
  display: inline-flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: ${space[2]};
`

const Small = styled.span`
  ${type.small}
  color: ${color.muted};
  overflow-wrap: anywhere;
`

const Empty = styled.p`
  margin: 0;
  padding: ${space[5]} ${space[8]};
  border-top: 1px solid ${color.line};
  color: ${color.muted};
`

const Footer = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[4]};
  padding: ${space[7]} ${space[8]};
  border-top: 1px solid ${color.line};
  border-radius: 0 0 ${radius.card} ${radius.card};
  background: ${color.surface2};
  ${type.small}
  span {
    flex: 1 1 200px;
  }
`
