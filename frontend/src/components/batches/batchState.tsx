import type { InboxWorkflowDto } from '@invimport/contracts'
import styled from 'styled-components'
import { color, radius, space, typeVar } from '../../theme/generated/tokens'
import { Pill } from '../ui/Pill'

/** A batch's one-word state, from its saved workflow counts. */
export function BatchState({ workflow }: { workflow?: InboxWorkflowDto }) {
  if (!workflow) {
    return null
  }
  if (workflow.lots === 0) {
    return <Pill status="draft">Draft</Pill>
  }
  if (workflow.active_jobs > 0) {
    return <Pill status="processing">Agents working</Pill>
  }
  if (workflow.open_questions > 0) {
    return <Pill status="needs-answer">{workflow.open_questions} need you</Pill>
  }
  if (workflow.approved >= workflow.lots) {
    return <Pill status="complete">Complete</Pill>
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

/** How much of the batch is added to InvenTree, as a thin bar beside its state. */
export function AddedBar({ workflow }: { workflow?: InboxWorkflowDto }) {
  if (!workflow || workflow.lots === 0) {
    return null
  }
  const share = Math.min(1, workflow.approved / workflow.lots)
  return (
    <Bar aria-hidden="true" data-complete={share === 1}>
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
