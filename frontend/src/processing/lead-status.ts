import { useEffect, useState } from 'react'
import type { ProcessingClient } from './types'

export const LEAD_STATUS_REFRESH_MS = 15_000

/**
 * The Examine lead session's latest status line for a batch, re-read whenever the capture
 * revision moves (each lot-forming write advances it). Undefined when there is no lead session.
 */
export function useLeadStatus(
  processing: ProcessingClient | undefined,
  batchId: string,
  revision: string,
): string | undefined {
  const [status, setStatus] = useState<string>()
  const [tick, setTick] = useState(0)
  // Status lines arrive without a capture change, so re-read on an interval as well.
  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), LEAD_STATUS_REFRESH_MS)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    let current = true
    const session = processing?.session
    if (!processing || !session) {
      return
    }
    void processing
      .read(batchId)
      .then((snapshot) => {
        const lead = snapshot.jobs.find((job) => job.stage === 'examine')
        return lead ? session.call(processing, batchId, lead.id) : undefined
      })
      .then((timeline) => {
        const last = timeline?.outbox.filter((item) => item.kind === 'status').at(-1)
        if (current) {
          setStatus(last?.kind === 'status' ? last.payload.text : undefined)
        }
      })
      .catch(() => {
        // The glance works without a status line; Processing shows read failures.
      })
    return () => {
      current = false
    }
  }, [processing, batchId, revision, tick])
  return status
}
