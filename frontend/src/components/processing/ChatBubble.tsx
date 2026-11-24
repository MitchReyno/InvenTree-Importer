import styled from 'styled-components'
import type { SessionHistoryEntryDto } from '@invimport/contracts'
import { EventTime } from '#/components/ui'
import { color, radius, space, typeVar } from '#/theme/generated/tokens'

/** A chat message or the agent's reply as a bubble: the operator's on the right. */
export function ChatBubble({ entry, text }: { entry: SessionHistoryEntryDto; text: string }) {
  const mine = entry.who !== 'agent'
  return (
    <Message data-mine={mine} $mine={mine} id={entry.id} tabIndex={-1}>
      <Who>
        {mine ? 'You' : 'Agent'} · <EventTime at={entry.at} />
        {entry.who !== 'agent' && !entry.read && (
          <>
            {' · '}
            <span>Not read yet</span>
          </>
        )}
      </Who>
      {text}
    </Message>
  )
}

const Message = styled.p<{ $mine: boolean }>`
  max-width: 85%;
  margin: 0;
  overflow-wrap: anywhere;
  padding: ${space[4]} ${space[5]};
  border-radius: ${radius.card};
  margin-left: ${({ $mine }) => ($mine ? 'auto' : '0')};
  background: ${({ $mine }) => ($mine ? color.accentWeak : color.surface2)};
`

const Who = styled.span`
  display: block;
  margin-bottom: ${space[1]};
  font-size: ${typeVar.label.size};
  font-weight: ${typeVar.bodyStrong.weight};
  color: ${color.muted};
`
