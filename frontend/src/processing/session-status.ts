import { useQuery } from '@tanstack/react-query'
import type { ProcessingSnapshotDto } from '@invimport/contracts'
import { serverQueryKey, useServerScope } from '#/queries/scope'
import { examineLead, subjectStatuses, WORK_STEPS } from './source'
import type { ProcessingClient } from './types'

export const SESSION_STATUS_REFRESH_MS = 15_000

export type SessionStatuses = {
  /** The Examine lead session's newest status line. */
  lead: string | undefined
  /** The lead session is running, so lots are still being formed. */
  leadRunning: boolean
  /** Each lot's newest line across its sessions, as "Step · line". */
  lots: ReadonlyMap<string, string>
}

const NONE: SessionStatuses = { lead: undefined, leadRunning: false, lots: new Map() }

/**
 * Session status lines for a batch, from the processing read, re-read whenever the capture
 * revision moves and on an interval, since status lines arrive without a capture change.
 */
export function useSessionStatuses(
  processing: ProcessingClient | undefined,
  batchId: string,
  revision: string,
): SessionStatuses {
  const scope = useServerScope()
  const query = useQuery({
    // A new capture revision is a new read; the previous lines stay until it arrives.
    queryKey: serverQueryKey(scope, 'processing', batchId, 'status', revision),
    queryFn: () => {
      if (!processing) {
        throw new Error('processing_unavailable')
      }
      return processing.read(batchId)
    },
    // Only a setup with sessions has status lines.
    enabled: Boolean(processing?.session),
    refetchInterval: SESSION_STATUS_REFRESH_MS,
    // The old timer kept running in a hidden tab; this keeps that cadence.
    refetchIntervalInBackground: true,
    // A failed read's last lines must not return as current under the next revision.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.state.status === 'error' ? undefined : previous,
    select: statusesOf,
  })
  // Old lines would read as current, so a failed or paused read drops them.
  if (!processing?.session || query.isError || query.fetchStatus === 'paused') {
    return NONE
  }

  return query.data ?? NONE
}

function statusesOf(snapshot: ProcessingSnapshotDto): SessionStatuses {
  const lead = examineLead(snapshot)

  const label = (step: string) => WORK_STEPS.find((item) => item.step === step)?.label ?? step

  return {
    lead: lead?.latest_status?.text,
    leadRunning: lead?.session_state === 'running',
    lots: new Map(
      // Only live sessions' lines: a finished or ended session's last line is history.
      [...subjectStatuses(snapshot)].map(([lotId, status]) => [
        lotId,
        `${label(status.step)} · ${status.text}`,
      ]),
    ),
  }
}
