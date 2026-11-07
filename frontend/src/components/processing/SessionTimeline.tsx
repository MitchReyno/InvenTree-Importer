import styled from 'styled-components'
import { space, typeVar } from '../../theme/generated/tokens'
import type { SessionTimelineDto } from '@invimport/contracts'
import { Heading, Small } from '../ui/primitives'

type Outbox = SessionTimelineDto['outbox'][number]

const stepText: Partial<Record<Outbox['kind'], string>> = {
  proposal: 'Published a proposal',
  question: 'Asked a question',
  observation: 'Recorded an observation',
  lot: 'Proposed a lot',
  regroup: 'Regrouped lots',
}

const time = (value: string) =>
  new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

/** Steps from status lines and results, plus the chat. Only the current activity is announced. */
export function SessionTimeline({ timeline }: { timeline: SessionTimelineDto }) {
  const steps = timeline.outbox.filter((item) => item.kind !== 'reply')
  const latest = [...timeline.outbox].reverse().find((item) => item.kind === 'status')
  const chat = [
    ...timeline.inbox
      .filter((item) => item.kind === 'chat' || item.kind === 'answer')
      .map((item) => ({
        at: item.created_at,
        text:
          item.kind === 'chat'
            ? `You: ${(item.payload as { text: string }).text}`
            : `You answered: ${answerText(item.payload)}`,
      })),
    ...timeline.outbox
      .filter((item) => item.kind === 'reply')
      .map((item) => ({
        at: item.created_at,
        text: `Agent: ${(item.payload as { text: string }).text}`,
      })),
  ].sort((a, b) => a.at.localeCompare(b.at))
  return (
    <section aria-label="Agent session">
      <Current role="status" aria-live="polite">
        {latest
          ? `Current activity: ${(latest.payload as { text: string }).text}`
          : 'No status yet'}
      </Current>
      {timeline.truncated && <Small>Older entries are not shown.</Small>}
      <Heading as="h4">Steps</Heading>
      <Steps aria-label="Session steps">
        {steps.map((item) => (
          <li key={`${item.session_id}:${item.seq}`}>
            <span>
              {item.kind === 'status'
                ? (item.payload as { text: string }).text
                : (stepText[item.kind] ?? item.kind)}
            </span>
            <Small as="time" dateTime={item.created_at}>
              {time(item.created_at)}
            </Small>
          </li>
        ))}
      </Steps>
      {chat.length > 0 && (
        <>
          <Heading as="h4">Chat</Heading>
          <Steps aria-label="Chat">
            {chat.map((item, index) => (
              <li key={index}>{item.text}</li>
            ))}
          </Steps>
        </>
      )}
    </section>
  )
}

function answerText(payload: unknown) {
  const value = (payload as { value: { kind: string; value?: string; text?: string } }).value
  return value.kind === 'quantity' ? `${value.value}` : (value.text ?? '')
}

const Current = styled.p`
  margin: ${space[4]} 0;
  font-weight: ${typeVar.bodyStrong.weight};
`

const Steps = styled.ol`
  margin: ${space[2]} 0 ${space[6]};
  padding-left: ${space[10]};
  li {
    display: flex;
    gap: ${space[6]};
    justify-content: space-between;
    padding: ${space[1]} 0;
  }
`
