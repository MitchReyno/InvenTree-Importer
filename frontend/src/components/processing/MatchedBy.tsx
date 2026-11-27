import styled from 'styled-components'
import type { MatchLotDto } from '@invimport/contracts'
import { keyText, keyWords } from '#/processing/match-view'
import { color, font, space, typeVar } from '#/theme/generated/tokens'

/** The lot's keys, each code in mono; a lot with none says what it lacks. */
export function MatchedBy({ match }: { match: MatchLotDto | undefined }) {
  if (!match) {
    return <Muted>—</Muted>
  }
  const keys = match.keys.filter((key) => key.kind !== 'batch_code')
  const batchCode = match.keys.find((key) => key.kind === 'batch_code')
  const reference = match.contribution && 'Import reference'
  if (keys.length === 0 && !reference) {
    return <Muted>{match.searchable ? '—' : 'Nothing to search with'}</Muted>
  }

  return (
    <Keys>
      {reference && <span>{reference}</span>}
      {keys.map((key, index) => {
        const { code, by } = keyWords(key)
        return (
          <span key={index}>
            <Code>{code}</Code>
            {by && ` + ${by}`}
          </span>
        )
      })}
      {batchCode && <Muted>{keyText(batchCode)}</Muted>}
    </Keys>
  )
}

const Keys = styled.span`
  display: grid;
  gap: ${space[1]};
`

const Code = styled.span`
  font-family: ${font.mono};
`

const Muted = styled.span`
  font-size: ${typeVar.small.size};
  color: ${color.muted};
`
