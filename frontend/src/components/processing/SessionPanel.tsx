import { useQuery } from '@tanstack/react-query'
import type { ProcessingJobDto } from '@invimport/contracts'
import type { ProcessingClient } from '../../processing/types'
import { serverQueryKey, useServerScope } from '../../queries/scope'
import { useRetainedPollInterval } from '../operations/LiveUpdates'
import { Small } from '../ui/primitives'
import { SessionChat } from './SessionChat'
import { SessionTimeline } from './SessionTimeline'

interface Props {
  batchId: string
  job: ProcessingJobDto
  client: Required<Pick<ProcessingClient, 'session' | 'chat'>>
  startFresh: () => void
}

/** A session's steps and chat. Live hints invalidate this read like every retained read. */
export function SessionPanel({ batchId, job, client, startFresh }: Props) {
  const scope = useServerScope()
  // Same retained-read polling as the Processing snapshot, for when live hints are unavailable.
  const pollInterval = useRetainedPollInterval()
  const timeline = useQuery({
    queryKey: serverQueryKey(scope, 'processing', batchId, 'session', job.id),
    queryFn: () => client.session(batchId, job.id),
    refetchInterval: pollInterval,
  })
  if (!timeline.data) {
    return (
      <Small>{timeline.isError ? 'Session history is unavailable.' : 'Loading session…'}</Small>
    )
  }
  return (
    <>
      {timeline.isRefetchError && (
        <Small role="status">Session history could not be refreshed; showing the last copy.</Small>
      )}
      <SessionTimeline timeline={timeline.data} />
      <SessionChat
        storeKey={`${batchId}:${job.id}`}
        state={timeline.data.session_state}
        send={async (text, key) => {
          await client.chat(batchId, job.id, { idempotency_key: key, text }, key)
          await timeline.refetch()
        }}
        startFresh={startFresh}
      />
    </>
  )
}
