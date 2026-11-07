import styled from 'styled-components'
import { color, space, type, typeVar } from '../../theme/generated/tokens'
import { batchHref } from '../../navigation/batch-route'
import { Button } from '../ui/Button'
import { media } from '../ui/media'
import { Pill } from '../ui/Pill'
import { RelativeTime } from '../ui/RelativeTime'
import { BatchThumbnail } from './BatchThumbnail'
import { BatchCounts, type InboxBatch } from './batchState'
import { Card, CardTitle } from './Card'

/** Where the batch's work picks up: its questions, then its lots to check, then Capture. */
function resumeAction(batch: InboxBatch) {
  if (batch.workflow?.open_questions) {
    return {
      href: batchHref(batch.id, { tab: 'processing', step: 'overview' }),
      label: `Open ${batch.workflow.open_questions} questions`,
    }
  }
  if (batch.workflow?.lots) {
    const { lots, needs_review } = batch.workflow
    // Lots still to check come first, so Review opens filtered to them.
    return {
      href: batchHref(
        batch.id,
        { tab: 'review', view: 'lots' },
        needs_review > 0 ? '?filter=needs_review' : '',
      ),
      label: `Review ${lots} ${lots === 1 ? 'lot' : 'lots'}`,
    }
  }
  return { href: batchHref(batch.id, { tab: 'capture' }), label: 'Continue Capture' }
}

/** The most recent batch, with what it needs next and the way back into it. */
export function ContinueCard({ batch }: { batch: InboxBatch }) {
  const resume = resumeAction(batch)
  const lastActivity = (
    <Meta>
      Last activity <RelativeTime at={batch.updated_at} />
    </Meta>
  )

  return (
    <Body aria-labelledby="continue-title">
      <ContinueImage>
        <BatchThumbnail batchId={batch.id} thumbnail={batch.workflow?.thumbnail} />
      </ContinueImage>
      <ContinueBody>
        <Eyebrow>Continue</Eyebrow>
        <CardTitle id="continue-title">{batch.title}</CardTitle>
        {batch.workflow ? (
          <>
            <Row>
              {batch.workflow.open_questions > 0 && (
                <Pill status="needs-answer">{batch.workflow.open_questions} need you</Pill>
              )}
              {batch.workflow.active_jobs > 0 && <Pill status="processing">Processing</Pill>}
              {lastActivity}
            </Row>
            <BatchCounts workflow={batch.workflow} />
          </>
        ) : (
          lastActivity
        )}
        <Actions>
          <Button as="a" href={resume.href} variant="primary">
            {resume.label}
          </Button>
          {batch.workflow && batch.workflow.ready > 0 && resume.label.startsWith('Open') && (
            // `ready` counts reviewed lots with nothing blocking and not yet approved: Ready to add.
            <Button as="a" href={batchHref(batch.id, { tab: 'changes', view: 'ready' })}>
              Add {batch.workflow.ready} ready {batch.workflow.ready === 1 ? 'lot' : 'lots'}
            </Button>
          )}
        </Actions>
      </ContinueBody>
    </Body>
  )
}

const Body = styled(Card)`
  display: grid;
  grid-template-columns: 200px minmax(0, 1fr);
  overflow: hidden;
  padding: 0;
  ${media.compact} {
    grid-template-columns: 96px minmax(0, 1fr);
  }
`

/** The batch's first photo, flush to the card's edge. */
const ContinueImage = styled.div`
  --thumbnail-width: 100%;
  --thumbnail-height: 100%;
  min-height: 180px;
  > div {
    border: 0;
    border-radius: 0;
  }
  ${media.compact} {
    min-height: 0;
  }
`

const ContinueBody = styled.div`
  display: grid;
  align-content: center;
  gap: ${space[5]};
  min-width: 0;
  padding: ${space[8]} ${space[9]};
`

const Eyebrow = styled.span`
  ${type.label}
  color: ${color.muted};
`

const Row = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[4]};
`

const Meta = styled.span`
  font-size: ${typeVar.small.size};
  color: ${color.muted};
`

const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[4]};
`
