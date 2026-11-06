import { useEffect, useState } from 'react'
import { subjectStatuses, WORK_STEPS } from './source'
import type { ProcessingClient } from './types'

export const SESSION_STATUS_REFRESH_MS = 15_000

export type SessionStatuses = {
  /** The Examine lead session's newest status line. */
  lead: string | undefined
  /** Each lot's newest line across its sessions, as "Step · line". */
  lots: ReadonlyMap<string, string>
}

const NONE: SessionStatuses = { lead: undefined, lots: new Map() }

/**
 * Session status lines for a batch, from the processing read, re-read whenever the capture
 * revision moves and on an interval, since status lines arrive without a capture change.
 */
export function useSessionStatuses(
  processing: ProcessingClient | undefined,
  batchId: string,
  revision: string,
): SessionStatuses {
  const [statuses, setStatuses] = useState<SessionStatuses>(NONE)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), SESSION_STATUS_REFRESH_MS)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    let current = true
    // Only a setup with sessions has status lines.
    if (!processing?.session) {
      return
    }
    void processing
      .read(batchId)
      .then((snapshot) => {
        if (!current) {
          return
        }
        const lead = snapshot.jobs.find((job) => job.stage === 'examine' && job.subject_id === null)

        const label = (step: string) => WORK_STEPS.find((item) => item.step === step)?.label ?? step

        setStatuses({
          lead: lead?.latest_status?.text,
          lots: new Map(
            [...subjectStatuses(snapshot)].map(([lotId, status]) => [
              lotId,
              `${label(status.step)} · ${status.text}`,
            ]),
          ),
        })
      })
      .catch(() => {
        // The glance works without status lines; Processing shows read failures.
      })
    return () => {
      current = false
    }
  }, [processing, batchId, revision, tick])
  return statuses
}
