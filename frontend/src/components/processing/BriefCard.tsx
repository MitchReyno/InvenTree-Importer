import { useEffect, useState } from 'react'
import styled from 'styled-components'
import { useQuery } from '@tanstack/react-query'
import type { SessionHistoryBriefDto, SessionHistoryBriefRefDto } from '@invimport/contracts'
import { Button, Small } from '#/components/ui'
import { useServerScope } from '#/context'
import { briefSummaryId } from '#/processing/brief-view'
import { serverQueryKey } from '#/queries/scope'
import { color, radius, space } from '#/theme/generated/tokens'
import { BriefDetails } from './BriefDetails'
import type { HistoryContext } from './HistoryLink'

export type BriefLoader = (
  batchId: string,
  jobId: string,
  attemptId: string,
) => Promise<SessionHistoryBriefDto>

/**
 * The brief a `/7` attempt started from, as the first item after its divider. The history says
 * where it sits; the brief is read on its own when the card mounts, and not on the history's
 * polls, so a brief that can't be read leaves the rest of the conversation as it is.
 */
export function BriefCard({
  reference,
  context,
  load,
}: {
  reference: SessionHistoryBriefRefDto
  context: HistoryContext
  load: BriefLoader
}) {
  const scope = useServerScope()
  const { batchId, jobId } = context
  const query = useQuery({
    queryKey: serverQueryKey(scope, 'session-brief', batchId, jobId, reference.attempt_id),
    queryFn: () => load(batchId, jobId, reference.attempt_id),
    staleTime: Infinity,
  })

  // Set by the operator's retry: the button they used goes away once the brief is read.
  const [focusOnRead, setFocusOnRead] = useState(false)
  const read = query.data !== undefined
  // Moves DOM focus to the brief's summary once a retried read has rendered it.
  useEffect(() => {
    if (!focusOnRead || !read) {
      return
    }
    document.getElementById(briefSummaryId(reference.attempt_id))?.focus()
    setFocusOnRead(false)
  }, [focusOnRead, read, reference.attempt_id])

  function retry() {
    setFocusOnRead(true)
    void query.refetch()
  }

  if (query.data) {
    return (
      <>
        {query.isRefetchError && (
          <Small role="status">
            Couldn’t read this brief again; showing the copy read earlier.
          </Small>
        )}
        <BriefDetails item={query.data} />
      </>
    )
  }
  if (query.isError) {
    return (
      <Placeholder role="alert">
        The brief this attempt started from couldn’t be loaded.{' '}
        <Button size="sm" onClick={retry}>
          Try again
        </Button>
      </Placeholder>
    )
  }
  return <Placeholder role="status">Loading the brief this attempt started from…</Placeholder>
}

const Placeholder = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[2]} ${space[3]};
  padding: ${space[3]} ${space[4]};
  border: 1px dashed ${color.lineStrong};
  border-radius: ${radius.card};
  color: ${color.muted};
`
