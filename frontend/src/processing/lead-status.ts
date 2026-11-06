import { useEffect, useState } from 'react'
import type { ProcessingClient } from './types'

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
  }, [processing, batchId, revision])
  return status
}
