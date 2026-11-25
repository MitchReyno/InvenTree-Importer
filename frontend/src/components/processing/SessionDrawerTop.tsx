import type { ProcessingJobDto } from '@invimport/contracts'
import { processingStepFor, sessionPageHref } from '#/navigation/batch-route'
import type { ProcessingClient } from '#/processing/types'
import { useNewestHistory } from '#/processing/useSessionHistory'
import { SessionDrawerHeader } from './SessionDrawerHeader'

type Props = {
  batchId: string
  job: ProcessingJobDto
  read: NonNullable<ProcessingClient['history']>
}

/**
 * The drawer's header, right under its title and above its questions. It shares the drawer's
 * newest-history query, so it reads nothing more; until that read lands it shows nothing.
 */
export function SessionDrawerTop({ batchId, job, read }: Props) {
  const history = useNewestHistory(read, batchId, job.id)
  if (!history.data) {
    return null
  }
  return (
    <SessionDrawerHeader
      session={history.data.session}
      fullSession={sessionPageHref(batchId, processingStepFor(job.stage), job.id)}
    />
  )
}
