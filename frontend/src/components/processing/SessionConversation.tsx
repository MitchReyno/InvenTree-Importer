import type { ReactNode } from 'react'
import styled from 'styled-components'
import type { SessionHistoryAttemptDto, SessionHistoryEntryDto } from '@invimport/contracts'
import {
  SessionFailureDetails,
  FAILED_SESSION_STATES,
  type FailureLoader,
} from '#/components/agents/SessionFailureDetails'
import { EventTime } from '#/components/ui'
import type { ConversationItem } from '#/processing/session-history'
import { color, radius, space, typeVar } from '#/theme/generated/tokens'
import { HistoryEntry, HistoryRow } from './HistoryList'
import type { HistoryContext } from './HistoryLinks'

const STARTED_BECAUSE = {
  first: 'first attempt',
  after_failure: 'after the previous attempt failed',
}

/** "Attempt N", with why it started only where the retained data records it. */
function attemptTitle(attempt: SessionHistoryAttemptDto) {
  const reason = attempt.started_because ? STARTED_BECAUSE[attempt.started_because] : null
  return reason ? `Attempt ${attempt.number} · ${reason}` : `Attempt ${attempt.number}`
}

function AttemptDivider({
  attempt,
  loadFailure,
}: {
  attempt: SessionHistoryAttemptDto
  loadFailure?: FailureLoader
}) {
  const title = attemptTitle(attempt)
  const failed = attempt.failure || FAILED_SESSION_STATES.has(attempt.session_state ?? '')
  return (
    <Divider>
      <hr aria-label={title} />
      <span>
        {title} · queued <EventTime at={attempt.queued_at} />
      </span>
      {failed && (
        <SessionFailureDetails
          attemptId={attempt.id}
          failure={attempt.failure}
          load={loadFailure}
        />
      )}
    </Divider>
  )
}

function Bubble({ entry, text }: { entry: SessionHistoryEntryDto; text: string }) {
  const mine = entry.who !== 'agent'
  return (
    <Message data-mine={mine} $mine={mine} id={entry.id}>
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

type Props = {
  items: ConversationItem[]
  context: HistoryContext
  /** The form that answers an open question in place, or none where it can't be answered now. */
  answerForm: (questionId: string) => ReactNode
  loadFailure?: FailureLoader
}

function Row({ item, context, answerForm, loadFailure }: Props & { item: ConversationItem }) {
  if (item.kind === 'attempt') {
    return <AttemptDivider attempt={item.attempt} loadFailure={loadFailure} />
  }
  if (item.kind !== 'entry') {
    return <HistoryRow item={item} context={context} />
  }
  const { entry } = item
  const { details } = entry
  if (details.kind === 'chat' || details.kind === 'reply') {
    return <Bubble entry={entry} text={details.text} />
  }
  if (details.kind === 'question') {
    const form = details.state === 'open' ? answerForm(details.question_id) : null
    return (
      <Card>
        <HistoryEntry entry={entry} context={context} />
        {form}
      </Card>
    )
  }
  return <HistoryEntry entry={entry} context={context} />
}

/** The session as one conversation, oldest first; inputs sit at the right, as chat does. */
export function SessionConversation(props: Props) {
  return (
    <List aria-label="Session conversation">
      {props.items.map((item) => (
        <li key={item.id}>
          <Row {...props} item={item} />
        </li>
      ))}
    </List>
  )
}

const List = styled.ol`
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: ${space[3]};
  min-width: 0;
`

const Divider = styled.div`
  display: grid;
  gap: ${space[2]};
  margin: ${space[4]} 0 ${space[2]};
  hr {
    margin: 0;
    border: 0;
    border-top: 1px solid ${color.lineStrong};
  }
  > span {
    font-size: ${typeVar.label.size};
    font-weight: ${typeVar.label.weight};
    letter-spacing: ${typeVar.label.letterSpacing};
    text-transform: uppercase;
    color: ${color.muted};
  }
`

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

const Card = styled.div`
  display: grid;
  gap: ${space[4]};
  padding: ${space[4]};
  border: 1px solid ${color.line};
  border-radius: ${radius.card};
  background: ${color.surface};
  min-width: 0;
`
