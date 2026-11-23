import type { HeaderWorkDto } from '@invimport/contracts'
import styled from 'styled-components'
import { color, radius, size, space, typeVar } from '#/theme/generated/tokens'
import { batchHref } from '#/navigation/batch-route'
import {
  stageCountText,
  stagePillWord,
  stageReason,
  stageStatus,
  type BatchCounts,
  type Stage,
} from '#/header/workSegments'
import { EventTime, media, StatePill, VisuallyHidden, type ProgressStep } from '#/components/ui'

type Session = HeaderWorkDto['active_sessions'][number]

/**
 * One stage: a link to its step page with its count, state and a status line, which is its newest
 * listed agent line or else a plain reason.
 */
export function StageRow({
  batch,
  stage,
  step,
  counts,
  sessions,
}: {
  batch: string
  stage: Stage
  step: ProgressStep
  counts: BatchCounts | undefined
  sessions: Session[]
}) {
  const count = stageCountText(stage, counts)
  const status = stageStatus(stage, sessions)

  return (
    <li>
      <RowLink href={batchHref(batch, { tab: 'processing', step: stage })}>
        <RowHead>
          <b>{step.label}</b>
          {count && (
            <RowCount>
              <VisuallyHidden> · </VisuallyHidden>
              {count}
            </RowCount>
          )}
          <VisuallyHidden> · </VisuallyHidden>
          <StatePill state={step.state} label={stagePillWord(step.state, counts?.steps[stage])} />
        </RowHead>
        <RowStatus>
          {status ? (
            <>
              {status.text} · <EventTime at={status.at} />
            </>
          ) : (
            stageReason(stage, step.state, counts)
          )}
        </RowStatus>
      </RowLink>
    </li>
  )
}

const RowLink = styled.a`
  display: flex;
  flex-direction: column;
  gap: ${space[1]};
  padding: ${space[3]} ${space[4]};
  border-radius: ${radius.btn};
  color: ${color.fg};
  text-decoration: none;
  &:hover {
    background: ${color.surface2};
  }
  ${media.compact} {
    min-height: ${size.touch};
  }
`

const RowHead = styled.span`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[3]};
  min-width: 0;
  & > :last-child {
    margin-left: auto;
  }
`

const RowCount = styled.span`
  font-size: ${typeVar.small.size};
  color: ${color.muted};
`

const RowStatus = styled.span`
  font-size: ${typeVar.small.size};
  color: ${color.muted};
  overflow-wrap: anywhere;
`
