import {
  SessionFailureDetails,
  FAILED_SESSION_STATES,
} from '#/components/agents/SessionFailureDetails'
import { useQuery } from '@tanstack/react-query'
import type { ProcessingJobDto } from '@invimport/contracts'
import type { ProcessingClient } from '#/processing/types'
import { serverQueryKey } from '#/queries/scope'
import { ReadState, Small } from '#/components/ui'
import { chatMessages, SessionChatPanel } from './SessionChatPanel'
import { SessionTimeline } from './SessionTimeline'
import { SessionSkeleton } from './SessionSkeleton'
import { useServerScope, useRetainedPollInterval, useReportRefreshing } from '#/context'

interface Props {
  batchId: string
  job: ProcessingJobDto
  client: Required<Pick<ProcessingClient, 'session' | 'chat'>> & Pick<ProcessingClient, 'failure'>
  freshDisabled?: boolean
  startFresh: () => void
}

/** A session's steps and chat. Live hints invalidate this read like every retained read. */
export function SessionPanel({ batchId, job, client, startFresh, freshDisabled }: Props) {
  const scope = useServerScope()
  // Same retained-read polling as the Processing snapshot, for when live hints are unavailable.
  const pollInterval = useRetainedPollInterval()
  const timeline = useQuery({
    queryKey: serverQueryKey(scope, 'processing', batchId, 'session', job.id),
    queryFn: () => client.session(batchId, job.id),
    refetchInterval: pollInterval,
  })
  useReportRefreshing(timeline.data !== undefined && timeline.isFetching)
  if (!timeline.data) {
    return timeline.isError ? (
      <Small>Session history is unavailable.</Small>
    ) : (
      <ReadState phase="empty" skeleton={<SessionSkeleton />}>
        {null}
      </ReadState>
    )
  }
  return (
    <>
      {(timeline.isRefetchError || timeline.fetchStatus === 'paused') && (
        <Small role="status">Session history could not be refreshed; showing the last copy.</Small>
      )}
      {(timeline.data.failure || FAILED_SESSION_STATES.has(timeline.data.session_state)) && (
        <SessionFailureDetails
          key={`${timeline.data.attempt_id}:${timeline.data.failure?.id ?? 'legacy'}`}
          attemptId={timeline.data.attempt_id}
          failure={timeline.data.failure}
          load={client.failure}
        />
      )}
      <SessionTimeline timeline={timeline.data} />
      <SessionChatPanel
        storeKey={`${batchId}:${job.id}`}
        state={timeline.data.session_state}
        messages={chatMessages(timeline.data)}
        send={async (text, key) => {
          await client.chat(batchId, job.id, { idempotency_key: key, text }, key)
          await timeline.refetch()
        }}
        startFresh={startFresh}
        freshDisabled={
          freshDisabled || timeline.isError || timeline.data.attempt_id !== job.attempt_id
        }
      />
    </>
  )
}
