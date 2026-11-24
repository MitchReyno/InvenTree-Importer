import styled from 'styled-components'
import {
  SessionFailureDetails,
  FAILED_SESSION_STATES,
} from '#/components/agents/SessionFailureDetails'
import type { ProcessingJobDto } from '@invimport/contracts'
import type { ProcessingClient } from '#/processing/types'
import { drawerItems } from '#/processing/session-history'
import {
  newestInboxSeq,
  unreadPendingSends,
  usePendingSendKey,
  usePendingSends,
} from '#/processing/pending-sends'
import { useNewestHistory } from '#/processing/useSessionHistory'
import { processingStepFor, sessionPageHref } from '#/navigation/batch-route'
import { Link, ReadState, Small, VisuallyHidden } from '#/components/ui'
import { space } from '#/theme/generated/tokens'
import { startFreshReason } from '#/processing/start-fresh'
import { SessionChatPanel } from './SessionChatPanel'
import { SessionSkeleton } from './SessionSkeleton'
import { SessionConversation } from './SessionConversation'

interface Props {
  batchId: string
  job: ProcessingJobDto
  client: Required<Pick<ProcessingClient, 'history' | 'chat'>> & Pick<ProcessingClient, 'failure'>
  freshDisabled?: boolean
  /** Why Start fresh would be refused now, from the batch's Processing read. */
  freshReason?: string
  startFresh: () => void
}

/**
 * The drawer's session: the newest page of its history, messages and answers in their place,
 * and the message box. It reads only the newest page; "Open full session" leads to every entry. Live hints invalidate it like every read.
 */
export function SessionPanel({
  batchId,
  job,
  client,
  startFresh,
  freshDisabled,
  freshReason,
}: Props) {
  const history = useNewestHistory(client.history, batchId, job.id)
  const storeKey = usePendingSendKey(batchId, job.id)
  const pending = usePendingSends(storeKey)
  const step = processingStepFor(job.stage)
  const fullSession = sessionPageHref(batchId, step, job.id)
  if (!history.data) {
    return history.isError || history.fetchStatus === 'paused' ? (
      <Small>
        Session history is unavailable. <Link href={fullSession}>Open full session</Link>
      </Small>
    ) : (
      <ReadState phase="empty" skeleton={<SessionSkeleton />}>
        {null}
      </ReadState>
    )
  }
  const { session, entries } = history.data
  const shownPending = unreadPendingSends(pending, entries)
  const current = session.attempts.find((attempt) => attempt.id === session.current_attempt_id)
  const sessionState = current?.session_state ?? job.session_state ?? 'queued'
  const latest = entries.find((entry) => entry.details.kind === 'status')
  const failed = current && (current.failure || FAILED_SESSION_STATES.has(sessionState))
  return (
    <>
      {(history.isRefetchError || history.fetchStatus === 'paused') && (
        <Small role="status">Session history could not be refreshed; showing the last copy.</Small>
      )}
      {failed && (
        <SessionFailureDetails
          key={`${current.id}:${current.failure?.id ?? 'legacy'}`}
          attemptId={current.id}
          failure={current.failure}
          load={client.failure}
        />
      )}
      <section aria-label="Agent session">
        {latest ? (
          <VisuallyHidden role="status" aria-live="polite">
            Current activity: {latest.summary}
          </VisuallyHidden>
        ) : (
          <Small role="status" aria-live="polite">
            No status yet. The agent’s steps appear here as it works.
          </Small>
        )}
        <History>
          {history.data.before && <Small>Older entries are on the full session page.</Small>}
          {(entries.length > 0 || shownPending.length > 0) && (
            <SessionConversation
              label="Session history"
              items={drawerItems(entries)}
              context={{ batchId, jobId: job.id, step }}
              working={sessionState === 'running'}
              pending={shownPending}
            />
          )}
          <Link href={fullSession}>Open full session</Link>
        </History>
      </section>
      <SessionChatPanel
        storeKey={storeKey}
        state={sessionState}
        newestInboxSeq={newestInboxSeq(entries)}
        send={async (text, key) => {
          const receipt = await client.chat(batchId, job.id, { idempotency_key: key, text }, key)
          // The message shows as saved until a read holds it, whether or not this read lands.
          void history.refetch()
          return receipt
        }}
        startFresh={startFresh}
        freshReason={freshReason ?? startFreshReason(session.start_fresh)}
        freshDisabled={
          freshDisabled || history.isError || session.current_attempt_id !== job.attempt_id
        }
      />
    </>
  )
}

const History = styled.div`
  display: grid;
  gap: ${space[3]};
`
