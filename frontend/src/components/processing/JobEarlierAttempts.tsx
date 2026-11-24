import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { SessionHistoryDto } from '@invimport/contracts'
import { serverQueryKey } from '#/queries/scope'
import { useServerScope } from '#/context'
import type { EarlierAttempt } from '#/agents/session-list'
import { EarlierAttempts } from '#/components/agents/EarlierAttempts'
import type { ProcessingClient } from '#/processing/types'
import { readNewestHistory } from '#/processing/useSessionHistory'

type Props = {
  batchId: string
  jobId: string
  /** How many attempts came before the current one, from the Processing read. */
  count: number
  history: NonNullable<ProcessingClient['history']>
}

/** The history metadata's attempts before the current one, newest first. */
function earlierFromHistory(history: SessionHistoryDto): EarlierAttempt[] {
  return history.session.attempts
    .filter((attempt) => attempt.id !== history.session.current_attempt_id)
    .map((attempt) => ({
      id: attempt.id,
      number: attempt.number,
      state: attempt.state,
      sessionState: attempt.session_state,
      at: attempt.ended?.at ?? attempt.queued_at,
      failure: attempt.failure,
    }))
}

/**
 * A step card's earlier attempts. The card may be on no loaded page of the session list, so the
 * attempts come from the job's history metadata, read when the fold first opens.
 */
export function JobEarlierAttempts({ batchId, jobId, count, history }: Props) {
  const scope = useServerScope()
  const [opened, setOpened] = useState(false)
  // The drawer's newest page, so opening either reads the history once.
  const query = useQuery({
    queryKey: serverQueryKey(scope, 'processing', batchId, 'history', jobId, 'newest'),
    queryFn: () => readNewestHistory(history, batchId, jobId),
    enabled: opened,
  })
  const attempts = query.data ? earlierFromHistory(query.data) : undefined
  let status: 'loading' | 'failed' | undefined
  if (opened && !attempts) {
    status = query.isError ? 'failed' : 'loading'
  }

  return (
    <EarlierAttempts
      count={attempts?.length ?? count}
      attempts={attempts}
      status={status}
      onOpen={() => setOpened(true)}
    />
  )
}
