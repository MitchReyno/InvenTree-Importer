import type { InboxWorkflowDto } from '@invimport/contracts'
import styled from 'styled-components'
import { Link, Small } from '../ui/primitives'

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
        <Link href={`#${batchId}/review?filter=reviewed`}>{workflow.ready} ready for approval</Link>
      )}
      {workflow.needs_review > 0 && (
        <Link href={`#${batchId}/review?filter=needs_review`}>
          {workflow.needs_review} need review
        </Link>
      )}
      {workflow.blocked > 0 && (
        <Link href={`#${batchId}/review`}>{workflow.blocked} blocked or warnings</Link>
      )}
      {(workflow.open_questions > 0 || workflow.active_jobs > 0) && (
        <Link href={`#${batchId}/processing/overview`}>
          {workflow.open_questions} open questions · {workflow.active_jobs} active jobs
        </Link>
      )}
      {workflow.approved > 0 && <span>{workflow.approved} already approved</span>}
      {workflow.latest_round && (
        <Link href={`#${batchId}/results/${workflow.latest_round.run_id}`}>
          Round {workflow.latest_round.round_number} · {workflow.latest_round.confirmed_stock} stock
          confirmed · {workflow.latest_round.state.replaceAll('_', ' ')}
        </Link>
      )}
    </Summary>
  )
}

const Summary = styled.div`
  display: flex;
  align-items: center;
  gap: 0 14px;
  flex-wrap: wrap;
  font-size: 13px;
  color: #526179;
  a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
  }
`
