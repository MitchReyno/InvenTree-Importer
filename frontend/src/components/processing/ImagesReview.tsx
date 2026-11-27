import styled from 'styled-components'
import { useQueryClient } from '@tanstack/react-query'
import type { MediaSnapshotDto, ProcessingImagesReviewDto } from '@invimport/contracts'
import { Banner, Heading, Paragraph, ReadState, Skeleton } from '#/components/ui'
import type { DirtyReport } from '#/navigation/unsaved-changes'
import { useDirtySources } from '#/operator/useDirtySources'
import { newestProposals } from '#/processing/images-review'
import type { ProcessingClient } from '#/processing/types'
import { serverQueryKey } from '#/queries/scope'
import { useFreshRead } from '#/queries/useFreshRead'
import { space } from '#/theme/generated/tokens'
import { useRetainedPollInterval, useServerScope } from '#/context'
import { ImagesProposalSection, type ImagesChat, type ImagesMedia } from './ImagesProposalSection'

/** The Processing client's Images review read and the session chat redo requests go through. */
export type ImagesReviewClient = {
  images: (batchId: string) => Promise<ProcessingImagesReviewDto>
  chat?: ProcessingClient['chat']
}

type Props = {
  batchId: string
  processing: ImagesReviewClient
  /** The media client Confirm edits through; absent where media isn't configured. */
  media?: Omit<ImagesMedia, 'accept'>
  lotLabel?: (lotId: string) => string | undefined
  /** Why nothing can be sent, such as an archived batch or a page shown from a snapshot. */
  closedReason?: string
  onDirtyChange?: DirtyReport
}

/** A lot the read names but this page has no label for, by the start of its id. */
function shortLotLabel(lotId: string) {
  return `Lot ${lotId.slice(0, 8)}`
}

/** Processing › Images' proposed crops: one section per lot with an Images proposal. */
export function ImagesReview({
  batchId,
  processing,
  media,
  lotLabel,
  closedReason,
  onDirtyChange,
}: Props) {
  const scope = useServerScope()
  const queryClient = useQueryClient()
  const interval = useRetainedPollInterval()
  const reviewKey = serverQueryKey(scope, 'processing-images', batchId)
  const mediaKey = serverQueryKey(scope, 'media', batchId)
  const fresh = useFreshRead({
    queryKey: reviewKey,
    queryFn: () => processing.images(batchId),
    refetchInterval: interval,
  })
  const drafts = useDirtySources(onDirtyChange)
  const review = fresh.query.data
  const proposals = review ? newestProposals(review) : []
  const unavailable = fresh.phase === 'failed'

  async function acceptReceipt(next: MediaSnapshotDto) {
    const cached = queryClient.getQueryData<MediaSnapshotDto>(mediaKey)
    // A replayed receipt can be older than a read that has landed since; it never replaces one.
    if (!cached || BigInt(next.revision) >= BigInt(cached.revision)) {
      queryClient.setQueryData(mediaKey, next)
    }
    // Writing the receipt clears the media read's proof, so both are read again.
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: mediaKey }),
      queryClient.invalidateQueries({ queryKey: reviewKey }),
    ])
  }

  const sendChat = processing.chat
  // A redo names its session from this read and carries no revision.
  const chat: ImagesChat | undefined = sendChat
    ? {
        send: (jobId, input, key) => sendChat(batchId, jobId, input, key),
        waitReason: fresh.settledAfterHint ? undefined : (fresh.reason ?? 'Updating…'),
        readyNow: fresh.settledAfterHintNow,
      }
    : undefined
  const sectionMedia = media ? { ...media, accept: acceptReceipt } : undefined
  // Confirm names this read's media revision, so it commands only from a read verified here.
  const reviewGate = {
    waitReason: fresh.commandsReady ? undefined : (fresh.reason ?? 'Updating…'),
    readyNow: fresh.commandsReadyNow,
  }

  return (
    <Review aria-label="Proposed crops">
      <Heading>Proposed crops</Heading>
      <ReadState
        phase={fresh.phase}
        hasData={review !== undefined}
        skeleton={<Skeleton width="100%" height={space[20]} />}
        failure={
          <div role="alert">
            <Banner tone="bad">Proposed crops are unavailable right now.</Banner>
          </div>
        }
      >
        {review && proposals.length === 0 && !unavailable && (
          <Paragraph>Images hasn’t proposed any crops yet.</Paragraph>
        )}
        {review &&
          proposals.map((proposal) => (
            <ImagesProposalSection
              // One owner per lot keeps its choices and requests across newer proposals.
              key={proposal.lot_id}
              batchId={batchId}
              proposal={proposal}
              selection={review.selections.find((item) => item.lot_id === proposal.lot_id)}
              mediaRevision={review.media_revision}
              lotLabel={lotLabel?.(proposal.lot_id) ?? shortLotLabel(proposal.lot_id)}
              review={reviewGate}
              media={sectionMedia}
              chat={chat}
              closedReason={closedReason}
              onChoicesDirty={drafts.forSource(`choices:${proposal.lot_id}`)}
              onRedoDirty={drafts.forSource(`redo:${proposal.lot_id}`)}
            />
          ))}
      </ReadState>
    </Review>
  )
}

const Review = styled.section`
  margin-bottom: ${space[10]};
`
