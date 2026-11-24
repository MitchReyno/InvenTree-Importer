import type { SessionHistoryDetailsDto } from '@invimport/contracts'
import { DebugDetails } from '#/components/ui'
import { photoViewCrop } from '#/media/types'
import { EntryCrop, Muted } from './history-styles'
import type { HistoryContext } from './HistoryLink'

type Details = Extract<SessionHistoryDetailsDto, { kind: 'photo_view' }>

/** The region recut from its page, with the size, region and, in debug mode, digest it was sent at. */
export function PhotoViewDetails({
  details,
  context,
}: {
  details: Details
  context: HistoryContext
}) {
  const { view, crop } = details
  return (
    <>
      {crop ? (
        <EntryCrop
          src={photoViewCrop(context.batchId, context.jobId, crop.attempt_id, crop.seq)}
          alt="Region sent to the agent, recut from the page"
          loading="lazy"
        />
      ) : (
        <Muted>The photo was removed, so the region can’t be recut.</Muted>
      )}
      <p>
        Sent {view.delivered.width} × {view.delivered.height}
        {view.region
          ? `, region ${view.region.width} × ${view.region.height} at ${view.region.x}, ${view.region.y}`
          : ', the whole page'}
        {view.page > 1 && ` of page ${view.page}`}. Recut from the page, so not the exact bytes
        sent.
      </p>
      <DebugDetails
        label="Photo view"
        rows={[{ label: 'Sent SHA-256', value: view.delivered.sha256 }]}
      />
    </>
  )
}
