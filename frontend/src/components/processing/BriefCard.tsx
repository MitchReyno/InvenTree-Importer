import { useRef, useState, type SyntheticEvent } from 'react'
import styled from 'styled-components'
import { useQuery } from '@tanstack/react-query'
import type { SessionHistoryBriefDto, SessionHistoryBriefRefDto } from '@invimport/contracts'
import { EventTime } from '#/components/ui'
import { useServerScope } from '#/context'
import { briefRefSummary, briefSummaryId } from '#/processing/brief-view'
import { serverQueryKey, type ServerScope } from '#/queries/scope'
import { color, radius, space, typeVar } from '#/theme/generated/tokens'
import { BriefBody } from './BriefBody'
import type { HistoryContext } from './HistoryLink'
import { HistoryText, HistoryTime } from './history-row-styles'

export type BriefLoader = (
  batchId: string,
  jobId: string,
  attemptId: string,
) => Promise<SessionHistoryBriefDto>

/**
 * Keyed by the server scope, as private reads are, but outside its prefix, so live updates
 * neither cancel nor re-read a brief; a scope change still clears it with the whole cache.
 */
function briefQueryKey(scope: ServerScope, batchId: string, jobId: string, attemptId: string) {
  const [, ...identity] = serverQueryKey(scope)
  return ['session-brief', ...identity, batchId, jobId, attemptId] as const
}

/**
 * The brief a `/7` attempt started from, as the first item after its divider. Collapsed, it
 * summarises the brief from the counts it was sealed with, which the history page carries;
 * its entries are read only when the operator opens it, and read again each time they do. Live
 * updates don't re-read an open brief; evidence removed while it is open shows gone when it is
 * next opened.
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
  const summaryId = briefSummaryId(reference.attempt_id)
  const [open, setOpen] = useState(false)
  // When the card was last opened: only a copy read since then is shown, so evidence removed
  // while it was closed never shows from an earlier read.
  const [openedAt, setOpenedAt] = useState(0)
  // Set while the operator's retry is in flight, so its button stays where their focus is.
  const [retrying, setRetrying] = useState(false)
  const retryButton = useRef<HTMLButtonElement>(null)
  const query = useQuery({
    queryKey: briefQueryKey(scope, batchId, jobId, reference.attempt_id),
    queryFn: () => load(batchId, jobId, reference.attempt_id),
    enabled: open,
  })

  function toggled(event: SyntheticEvent<HTMLDetailsElement>) {
    const opened = event.currentTarget.open
    if (opened) {
      setOpenedAt(Date.now())
    }
    setOpen(opened)
  }

  async function retry() {
    setRetrying(true)
    const result = await query.refetch()
    // The button goes once the brief is read; focus follows only if the operator is still on it.
    const stillOnRetry = document.activeElement === retryButton.current
    setRetrying(false)
    if (result.data && stillOnRetry) {
      document.getElementById(summaryId)?.focus()
    }
  }

  const readSinceOpened = query.data !== undefined && query.dataUpdatedAt >= openedAt

  return (
    <Card id={`brief:${reference.attempt_id}`} aria-labelledby={summaryId} onToggle={toggled}>
      <summary id={summaryId}>
        <HistoryText>{briefRefSummary(reference)}</HistoryText>
        <HistoryTime>
          <EventTime at={reference.at} />
        </HistoryTime>
      </summary>
      {open && (
        <BriefBody
          brief={readSinceOpened ? query.data : undefined}
          failed={query.isError}
          retrying={retrying}
          retry={() => void retry()}
          retryButton={retryButton}
        />
      )}
    </Card>
  )
}

const Card = styled.details`
  min-width: 0;
  border: 1px solid ${color.lineStrong};
  border-radius: ${radius.card};
  background: ${color.surface};
  overflow-wrap: anywhere;
  > summary {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: ${space[1]} ${space[3]};
    padding: ${space[3]} ${space[4]};
    cursor: pointer;
    font-weight: ${typeVar.bodyStrong.weight};
  }
  /* The flex summary drops the native marker, so the card draws its own. */
  > summary::before {
    content: '▸';
    color: ${color.muted};
  }
  &[open] > summary::before {
    content: '▾';
  }
`
