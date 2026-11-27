import type { BatchActivityEntryDto, SessionHistoryLinkDto } from '@invimport/contracts'
import { Link } from '#/components/ui'
import { processingStepFor } from '#/navigation/batch-route'
import { linkTarget } from './HistoryLink'

/** What an activity line is about, named by its label and linked where it still leads. */
export function ActivitySubject({
  link,
  item,
  batchId,
}: {
  link: SessionHistoryLinkDto
  item: BatchActivityEntryDto
  batchId: string
}) {
  const context = { batchId, jobId: item.job_id, step: processingStepFor(item.stage) }
  const target = linkTarget(link, context)
  const label = 'label' in link ? link.label : target.text
  if (target.href === undefined || link.kind === 'external_url') {
    return <span>{label}</span>
  }
  return <Link href={target.href}>{label}</Link>
}
