import type { InboxWorkflowDto } from '@invimport/contracts'
import styled from 'styled-components'
import { color, radius, space } from '../../theme/generated/tokens'
import { media } from '../ui/media'
import { Link, Small } from '../ui/primitives'
import { batchHref } from '../../navigation/batch-route'

export function BatchWorkflow({
  batchId,
  workflow,
}: {
  batchId: string
  workflow?: InboxWorkflowDto
}) {
  if (!workflow) {
    return <Small>Open this batch for current work and outcomes.</Small>
  }
  return (
    <Summary aria-label="Retained workflow summary">
      <span>
        {workflow.lots ? `${workflow.lots} physical lots` : 'Draft · no physical lots yet'}
      </span>
      {workflow.ready > 0 && (
        <Link href={batchHref(batchId, { tab: 'review', view: 'lots' }, '?filter=reviewed')}>
          {workflow.ready} ready for approval
        </Link>
      )}
      {workflow.needs_review > 0 && (
        <Link href={batchHref(batchId, { tab: 'review', view: 'lots' }, '?filter=needs_review')}>
          {workflow.needs_review} need review
        </Link>
      )}
      {workflow.blocked > 0 && (
        <Link href={batchHref(batchId, { tab: 'review', view: 'lots' })}>
          {workflow.blocked} blocked or warnings
        </Link>
      )}
      {(workflow.open_questions > 0 || workflow.active_jobs > 0) && (
        <Link href={batchHref(batchId, { tab: 'processing', step: 'overview' })}>
          {workflow.open_questions} open questions · {workflow.active_jobs} active jobs
        </Link>
      )}
      {workflow.approved > 0 && <span>{workflow.approved} already approved</span>}
      {workflow.latest_round && (
        <Link
          href={batchHref(batchId, {
            tab: 'changes',
            view: 'added',
            runId: workflow.latest_round.run_id,
          })}
        >
          Round {workflow.latest_round.round_number} · {workflow.latest_round.confirmed_stock} stock
          confirmed · {workflow.latest_round.state.replaceAll('_', ' ')}
        </Link>
      )}
    </Summary>
  )
}

const Summary = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[1]} ${space['1-5']};
  font-size: 12.5px;
  color: ${color.muted};
  > span {
    padding: 1px 0;
  }
  a {
    display: inline-flex;
    align-items: center;
    padding: 1px ${space[2]};
    border-radius: ${radius.pill};
    background: ${color.surface2};
    color: ${color.fg};
    font-weight: 500;
    text-decoration: none;
  }
  a:hover {
    background: ${color.accentWeak};
  }
  ${media.compact} {
    a {
      min-height: 44px;
    }
  }
`
