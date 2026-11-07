import type { SessionTimelineDto } from '@invimport/contracts'
import { StatusTimeline } from '../ui/StatusTimeline'
import { Small } from '../ui/primitives'
import { VisuallyHidden } from '../ui/VisuallyHidden'

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

/**
 * The session's steps from its status lines and results, as a `StatusTimeline` with the newest
 * status current. Only the current activity is announced; the chat is in `SessionChatPanel`.
 */
export function SessionTimeline({ timeline }: { timeline: SessionTimelineDto }) {
  const steps = timeline.outbox.filter((item) => item.kind !== 'reply')
  const latest = [...steps].reverse().find((item) => item.kind === 'status')

  return (
    <section aria-label="Agent session">
      {latest ? (
        <VisuallyHidden role="status" aria-live="polite">
          Current activity: {(latest.payload as { text: string }).text}
        </VisuallyHidden>
      ) : (
        <Small role="status" aria-live="polite">
          No status yet. The agent’s steps appear here as it works.
        </Small>
      )}
      {timeline.truncated && <Small>Older entries are not shown.</Small>}
      {steps.length > 0 && (
        <StatusTimeline
          label="Session steps"
          entries={steps.map((item) => ({
            text:
              item.kind === 'status'
                ? (item.payload as { text: string }).text
                : (stepText[item.kind] ?? item.kind),
            time: time(item.created_at),
            current: item === latest,
          }))}
        />
      )}
    </section>
  )
}
