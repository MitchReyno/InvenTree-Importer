import styled from 'styled-components'
import { batchHref } from '#/navigation/batch-route'
import type { ProposedLot, ProposedLotState } from '#/processing/proposed-lots'
import { color, radius, space, type, typeVar } from '#/theme/generated/tokens'
import {
  Button,
  Skeleton,
  Spinner,
  Count,
  Pill,
  type PillTone,
  linkTouchArea,
} from '#/components/ui'

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
  // Crops cover pixel regions only; the count includes document lines too.
  const observations = lot.observations ?? lot.crops?.length ?? 0
  if (observations) {
    parts.push(plural(observations, 'observation'))
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
  leadRunning = false,
  limit,
}: {
  batchId: string
  lots: ProposedLot[]
  leadStatus?: string
  /** The lead session is still forming lots. */
  leadRunning?: boolean
  /** Shows only the first lots, with a link to all of them in Review. */
  limit?: number
}) {
  const shown = limit === undefined ? lots : lots.slice(0, limit)
  return (
    <Glance aria-label={`Proposed lots, ${lots.length}`}>
      <Head>
        <Title>
          Proposed lots <Count value={lots.length} />
          {leadRunning && (
            <SortingPill>
              <Pill status="running">Sorting</Pill>
            </SortingPill>
          )}
        </Title>
        {leadStatus && (
          <Lead role="status">
            {/* A stopped session's last line stays as text; only running work spins. */}
            {leadRunning && <Spinner />}
            Examine · {leadStatus}
          </Lead>
        )}
      </Head>
      {lots.length === 0 && !leadRunning ? (
        <Empty>No lots yet. Processing proposes them from the evidence.</Empty>
      ) : (
        <List>
          {shown.map((lot) => {
            const detail = meta(lot)
            return (
              <Row key={lot.id} aria-label={lot.label}>
                <Thumb>
                  {lot.crops?.[0] ? (
                    <img {...lot.crops[0]} loading="lazy" decoding="async" alt={lot.label} />
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
          {leadRunning && (
            <Row aria-hidden="true">
              <Skeleton width="44px" height="34px" />
              <Body>
                <Skeleton width="70%" height="10px" />
              </Body>
              <Small>Finding…</Small>
            </Row>
          )}
        </List>
      )}
      {limit !== undefined && lots.length > limit && (
        <More>
          <a href={batchHref(batchId, { tab: 'review', view: 'lots' })}>
            See all {lots.length} lots
          </a>
        </More>
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

const SortingPill = styled.span`
  margin-left: auto;
`

const More = styled.p`
  margin: 0;
  padding: ${space[5]} ${space[8]};
  border-top: 1px solid ${color.line};
  ${type.small}
  a {
    color: ${color.accent};
    ${linkTouchArea}
  }
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
