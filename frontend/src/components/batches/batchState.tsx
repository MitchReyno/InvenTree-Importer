import type { InboxWorkflowDto } from '@invimport/contracts'
import type { CaptureList } from '../../../../contracts/generated/api.d.ts'
import styled from 'styled-components'
import { color, radius, space, typeVar } from '../../theme/generated/tokens'
import { Pill } from '../ui/Pill'

/** A batch as the Batches list reads it, with its saved workflow counts when present. */
export type InboxBatch = CaptureList['batches'][number] & { workflow?: InboxWorkflowDto }

/** Rounds that stopped short; their lots are approved but not known to be in InvenTree. */
const RECOVERY = new Set(['recovery_required', 'settled_incomplete'])
const SETTLED = new Set(['settled_complete', 'settled_incomplete'])

/** Every lot approved and the last round confirmed complete; approval alone is not completion. */
function addedComplete(workflow: InboxWorkflowDto) {
  return workflow.approved >= workflow.lots && workflow.latest_round?.state === 'settled_complete'
}

/** A batch's one-word state, from its saved workflow counts and its latest import round. */
export function BatchState({ workflow }: { workflow?: InboxWorkflowDto }) {
  if (!workflow) {
    return null
  }
  // The batch-level Examine can run or ask before any lot exists, so work outranks Draft.
  if (workflow.active_jobs > 0) {
    // `active_jobs` counts queued jobs too, so this does not claim an agent has started.
    return <Pill status="processing">Processing</Pill>
  }
  if (workflow.open_questions > 0) {
    return <Pill status="needs-answer">{workflow.open_questions} need you</Pill>
  }
  if (workflow.lots === 0) {
    return <Pill status="draft">Draft</Pill>
  }
  const round = workflow.latest_round
  if (round && RECOVERY.has(round.state)) {
    return <Pill status="failed">Needs recovery</Pill>
  }
  if (round && !SETTLED.has(round.state)) {
    return <Pill status="processing">Adding to InvenTree</Pill>
  }
  if (workflow.approved >= workflow.lots) {
    return addedComplete(workflow) ? (
      <Pill status="complete">Complete</Pill>
    ) : (
      <Pill tone="acc" glyph="◐">
        Approved
      </Pill>
    )
  }
  if (workflow.approved > 0) {
    return (
      <Pill tone="acc" glyph="◐">
        Partly complete
      </Pill>
    )
  }
  if (workflow.ready > 0) {
    return <Pill status="ready">{workflow.ready} ready</Pill>
  }
  return <Pill tone="neutral">In review</Pill>
}

/** How much of the batch is approved, as a thin bar; it turns green only once added complete. */
export function AddedBar({ workflow }: { workflow?: InboxWorkflowDto }) {
  if (!workflow || workflow.lots === 0) {
    return null
  }
  const share = Math.min(1, workflow.approved / workflow.lots)
  return (
    <Bar aria-hidden="true" data-complete={addedComplete(workflow)}>
      <span style={{ width: `${Math.round(share * 100)}%` }} />
    </Bar>
  )
}

/** The counts that matter, with the numbers in bold. */
export function BatchCounts({ workflow }: { workflow: InboxWorkflowDto }) {
  const parts: [number, string][] = [
    [workflow.lots, workflow.lots === 1 ? 'lot proposed' : 'lots proposed'],
    [workflow.ready, 'ready'],
    [workflow.open_questions, workflow.open_questions === 1 ? 'question' : 'questions'],
    [workflow.blocked, 'blocked'],
  ]
  return (
    <Counts aria-label="Batch counts">
      {parts
        .filter(([value], index) => index === 0 || value > 0)
        .map(([value, word]) => (
          <span key={word}>
            <b>{value}</b> {word}
          </span>
        ))}
    </Counts>
  )
}

const Bar = styled.span`
  display: block;
  width: 120px;
  height: 6px;
  overflow: hidden;
  border-radius: ${radius.pill};
  background: ${color.surface2};
  span {
    display: block;
    height: 100%;
    background: ${color.accent};
  }
  &[data-complete='true'] span {
    background: ${color.ok};
  }
`

const Counts = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space[2]} ${space[6]};
  font-size: ${typeVar.small.size};
`
