import styled from 'styled-components'
import { useQuery } from '@tanstack/react-query'
import type { SessionHistoryBriefDto, SessionHistoryBriefRefDto } from '@invimport/contracts'
import { Button } from '#/components/ui'
import { useServerScope } from '#/context'
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
 * where it sits; the brief is read on its own, once, since a sealed brief doesn't change, so a
 * brief that can't be read leaves the rest of the conversation as it is.
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

  if (query.data) {
    return <BriefDetails item={query.data} />
  }
  if (query.isError) {
    return (
      <Placeholder role="alert">
        The brief this attempt started from couldn’t be loaded.{' '}
        <Button size="sm" onClick={() => void query.refetch()}>
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
