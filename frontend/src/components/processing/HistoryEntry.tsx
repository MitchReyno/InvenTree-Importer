import styled from 'styled-components'
import type { SessionHistoryEntryDto } from '@invimport/contracts'
import { EventTime } from '#/components/ui'
import { color, space, typeVar } from '#/theme/generated/tokens'
import { HistoryEntryDetails, hasDetails } from './HistoryEntryDetails'
import { HistoryLinks, type HistoryContext } from './HistoryLinks'
import { HistoryDetails, HistoryLine, HistoryText, HistoryTime } from './history-row-styles'

/**
 * One entry: a line, or native `<details>` that expands to its details and links. An input says
 * whose it is and, until the session acknowledges it, that it isn't read yet.
 */
export function HistoryEntry({
  entry,
  context,
}: {
  entry: SessionHistoryEntryDto
  context: HistoryContext
}) {
  const input = entry.who !== 'agent'
  const line = (
    <>
      {entry.who !== 'agent' && (
        <Who>
          {entry.who === 'operator' ? 'You' : 'App'}
          {!entry.read && <Unread> · Not read yet</Unread>}
        </Who>
      )}
      <HistoryText>{entry.summary}</HistoryText>
      <HistoryTime>
        <EventTime at={entry.at} />
      </HistoryTime>
    </>
  )
  if (!hasDetails(entry) && entry.links.length === 0) {
    return (
      <HistoryLine $input={input} id={entry.id} tabIndex={-1}>
        {line}
      </HistoryLine>
    )
  }
  return (
    <HistoryDetails $input={input} id={entry.id}>
      <summary>{line}</summary>
      <Body>
        <HistoryEntryDetails entry={entry} context={context} />
        <HistoryLinks links={entry.links} context={context} />
      </Body>
    </HistoryDetails>
  )
}

const Body = styled.div`
  display: grid;
  gap: ${space[3]};
  margin-top: ${space[3]};
  p,
  ul,
  ol {
    margin: 0;
  }
`

const Who = styled.span`
  font-size: ${typeVar.label.size};
  font-weight: ${typeVar.label.weight};
  text-transform: uppercase;
  letter-spacing: ${typeVar.label.letterSpacing};
  color: ${color.accent};
`

const Unread = styled.span`
  color: ${color.warn};
`
