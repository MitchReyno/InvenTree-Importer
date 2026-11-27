import styled from 'styled-components'
import type { MatchCandidateDto } from '@invimport/contracts'
import { Pill } from '#/components/ui'
import { keyText, missingWords, partName, presentWords } from '#/processing/match-view'
import { color, font, radius, space, typeVar } from '#/theme/generated/tokens'

/**
 * One candidate a match question quotes: an InvenTree Part with the keys it matched by, what
 * InvenTree has and lacks of it and its stock with the lot's batch code, or a competing lot in
 * another batch.
 */
export function MatchCandidate({ candidate }: { candidate: MatchCandidateDto }) {
  const keys = (
    <Keys aria-label="Matched by">
      {candidate.matched_by.map(({ key }, index) => (
        <Key key={index}>{keyText(key)}</Key>
      ))}
    </Keys>
  )

  if (candidate.kind === 'lot') {
    return (
      <Item>
        <b>
          {candidate.lot_label} in {candidate.batch_title}
        </b>
        <Muted>A competing lot, not yet approved; it isn’t in InvenTree.</Muted>
        {keys}
      </Item>
    )
  }

  const name = partName(candidate)
  const missing = missingWords(candidate.missing)
  const present = presentWords(candidate)

  return (
    <Item>
      <span>
        <b>{name}</b>
        {candidate.part.ipn && <Muted> · {candidate.part.name}</Muted>}
      </span>
      {keys}
      <Has aria-label={`InvenTree has, for ${name}`}>
        <Muted>InvenTree has:</Muted>
        {present.map((word) => (
          <Pill key={word} tone="ok">
            {word}
          </Pill>
        ))}
        {missing.map((word) => (
          <Pill key={word} tone="warn" glyph="!">
            {word}
          </Pill>
        ))}
        {!candidate.parameters_known && <Muted>key parameters couldn’t be checked</Muted>}
      </Has>
      {candidate.stock.length > 0 && (
        <Muted>
          Stock with this batch code:{' '}
          {candidate.stock
            .map((stock) => `#${stock.pk} · batch ${stock.batch} · ${stock.quantity}`)
            .join('; ')}
        </Muted>
      )}
    </Item>
  )
}

const Item = styled.li`
  display: grid;
  gap: ${space[2]};
  padding: ${space[4]};
  border: 1px solid ${color.line};
  border-radius: ${radius.input};
  background: ${color.surface};
`

const Keys = styled.span`
  display: flex;
  flex-wrap: wrap;
  gap: ${space[2]};
`

const Key = styled.span`
  padding: 1px ${space[3]};
  border-radius: ${radius.sm};
  background: ${color.surface2};
  font-family: ${font.mono};
  font-size: ${typeVar.small.size};
`

const Has = styled.span`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[2]};
`

const Muted = styled.span`
  font-size: ${typeVar.small.size};
  color: ${color.muted};
`
