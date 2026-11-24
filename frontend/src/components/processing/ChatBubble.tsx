import type { ReactNode } from 'react'
import styled from 'styled-components'
import { EventTime } from '#/components/ui'
import { color, radius, space, typeVar } from '#/theme/generated/tokens'

type Props = {
  /** The entry's ID, so a link can bring the bubble into view; none while it is being sent. */
  id?: string
  mine: boolean
  /** "You", or the agent's stage name. */
  author: string
  text: string
  /** When it was saved; absent while it is being sent. */
  at?: string
  /** The operator's input the session hasn't read yet. */
  unread?: boolean
  /** The question an answer replies to, quoted above it. */
  quote?: { asker: string; question: ReactNode }
  /** What the answer changed, beside its time. */
  note?: string
}

/**
 * A message, reply or answer as a bubble: the operator's on the right, the agent's on the left,
 * each naming its author. An answer quotes the question it answers.
 */
export function ChatBubble({ id, mine, author, text, at, unread, quote, note }: Props) {
  return (
    <Message data-mine={mine} $mine={mine} id={id} tabIndex={id ? -1 : undefined}>
      <Who>{author}</Who>
      {quote && (
        <Quote>
          <span>{quote.asker} asked</span>
          {quote.question}
        </Quote>
      )}
      <Text>{text}</Text>
      <Foot>
        {note && <span>{note}</span>}
        {unread && <span>Not read yet</span>}
        {at ? <EventTime at={at} /> : <span>Sending…</span>}
      </Foot>
    </Message>
  )
}

const Message = styled.div<{ $mine: boolean }>`
  display: grid;
  gap: ${space[3]};
  max-width: 84%;
  min-width: 0;
  overflow-wrap: anywhere;
  padding: ${space[4]} ${space[6]};
  border-radius: ${radius.card};
  justify-self: ${({ $mine }) => ($mine ? 'end' : 'start')};
  margin-left: ${({ $mine }) => ($mine ? 'auto' : '0')};
  background: ${({ $mine }) => ($mine ? color.accentWeak : color.surface2)};
`

const Who = styled.span`
  font-size: ${typeVar.label.size};
  font-weight: ${typeVar.bodyStrong.weight};
  color: ${color.muted};
`

const Text = styled.span`
  white-space: pre-wrap;
`

const Quote = styled.span`
  display: grid;
  gap: ${space[1]};
  padding: ${space[2]} ${space[4]};
  border-left: ${space[2]} solid ${color.lineStrong};
  border-radius: ${radius.xs};
  background: ${color.surface};
  font-size: ${typeVar.small.size};
  > span {
    color: ${color.muted};
  }
`

const Foot = styled.span`
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: ${space[4]};
  font-size: ${typeVar.label.size};
  color: ${color.muted};
`
