import styled from 'styled-components'
import { color } from '../../theme/generated/tokens'
import type {
  CaptureSnapshotDto,
  ManualWorkspaceDto,
  OperatorLotDto,
  OperatorReviewDto,
} from '@invimport/contracts'
import { Button, Heading, Panel, Small } from '../ui/primitives'
import { display } from '../../capture/display'
import {
  GROUP_LABELS,
  GROUP_ORDER,
  matchesFilter,
  queueGroup,
  type QueueGroup,
  type ReviewFilter,
} from '../../operator/review-model'
import { LotStatusChips } from '../operator/LotStatusChips'
import { RetiredLots } from '../operator/RetiredLots'

interface Props {
  batch: CaptureSnapshotDto
  workspace: ManualWorkspaceDto
  operatorReview?: OperatorReviewDto
  filter: ReviewFilter
  /** Active lots in visible order; keyboard movement follows the same order. */
  lotIds: string[]
  selected: string[]
  focused: string | null
  busy: boolean
  maxSelected: number
  toggle: (id: string) => void
  inspect: (id: string) => void
}

type CaptureLot = CaptureSnapshotDto['lots'][number]

function groupsFor(lots: CaptureLot[], operatorReview?: OperatorReviewDto) {
  const operatorLots = new Map(operatorReview?.lots.map((lot) => [lot.lot_id, lot]))
  const groups = new Map<QueueGroup, CaptureLot[]>()
  for (const lot of lots) {
    const operatorLot = operatorLots.get(lot.id)
    const group = operatorLot ? queueGroup(operatorLot) : 'needs_review'
    groups.set(group, [...(groups.get(group) ?? []), lot])
  }
  return GROUP_ORDER.filter((group) => groups.has(group)).map((group) => ({
    group,
    lots: groups.get(group)!,
  }))
}

/** Visible active lots in queue order for the current filter. */
export function visibleQueueLotIds(
  batch: CaptureSnapshotDto,
  operatorReview: OperatorReviewDto | undefined,
  filter: ReviewFilter,
): string[] {
  if (!operatorReview) {
    return batch.lots.filter((lot) => !lot.retired).map((lot) => lot.id)
  }
  const active = new Map(operatorReview.lots.map((lot) => [lot.lot_id, lot]))
  const lots = batch.lots.filter((lot) => {
    const operatorLot = active.get(lot.id)
    return !lot.retired && operatorLot !== undefined && matchesFilter(operatorLot, filter)
  })
  return groupsFor(lots, operatorReview).flatMap((group) => group.lots.map((lot) => lot.id))
}

function legacyStatus(approved: boolean | undefined, reviewed: boolean | undefined) {
  if (approved) {
    return 'Original approval retained'
  }
  return reviewed ? 'Reviewed exact saved values' : 'Needs review'
}

export function ReviewQueue({
  batch,
  workspace,
  operatorReview,
  filter,
  lotIds,
  selected,
  focused,
  busy,
  maxSelected,
  toggle,
  inspect,
}: Props) {
  if (filter === 'retired' && operatorReview) {
    return <RetiredLots batch={batch} review={operatorReview} />
  }
  const lots = lotIds
    .map((id) => batch.lots.find((lot) => lot.id === id))
    .filter((lot): lot is CaptureLot => lot !== undefined)
  const operatorLots = new Map<string, OperatorLotDto>(
    operatorReview?.lots.map((lot) => [lot.lot_id, lot]),
  )
  return (
    <Panel aria-label="Physical lot review queue">
      <Heading>Physical lots</Heading>
      <Small>
        Select up to {maxSelected} original contributions. Sharing a Part never includes another
        lot.
      </Small>
      {!lots.length && <Small>No lots match this filter.</Small>}
      {groupsFor(lots, operatorReview).map(({ group, lots: grouped }) => (
        <Group key={group} aria-label={`${GROUP_LABELS[group]} · ${grouped.length}`}>
          {operatorReview && (
            <GroupTitle>
              {GROUP_LABELS[group]} · {grouped.length}
            </GroupTitle>
          )}
          {grouped.map((lot) => {
            const status = workspace.lots.find((value) => value.lot_id === lot.id)
            const operatorLot = operatorLots.get(lot.id)
            const approved =
              operatorLot?.approved ??
              status?.issues.some(
                (value) => value.code === 'original_contribution_already_approved',
              )
            const atCapacity = !selected.includes(lot.id) && selected.length >= maxSelected
            return (
              <QueueRow key={lot.id} $focused={focused === lot.id}>
                <CheckLabel>
                  <input
                    type="checkbox"
                    aria-label={`Select ${lot.label}`}
                    checked={selected.includes(lot.id)}
                    disabled={busy || batch.archived || Boolean(approved) || atCapacity}
                    onChange={() => toggle(lot.id)}
                  />
                  <strong>{lot.label}</strong>
                </CheckLabel>
                <Small>{display(lot.quantity, batch, 'quantity')}</Small>
                {operatorLot ? (
                  <LotStatusChips lot={operatorLot} />
                ) : (
                  <Small>{legacyStatus(approved, status?.reviewed)}</Small>
                )}
                <Button disabled={busy} onClick={() => inspect(lot.id)}>
                  Inspect {lot.label}
                </Button>
              </QueueRow>
            )
          })}
        </Group>
      ))}
    </Panel>
  )
}

const Group = styled.section`
  margin-top: 12px;
`
const GroupTitle = styled.h3`
  margin: 0;
  font-size: 12px;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  color: ${color.muted};
`
const QueueRow = styled.div<{ $focused: boolean }>`
  display: grid;
  gap: 6px;
  padding: 12px;
  margin-top: 10px;
  border: 1px solid ${(p) => (p.$focused ? color.accent : color.line)};
  border-left-width: ${(p) => (p.$focused ? '4px' : '1px')};
  border-radius: 5px;
  background: ${(p) => (p.$focused ? color.accentWeak : color.surface2)};
  button {
    margin-top: 3px;
    width: 100%;
    text-align: left;
  }
`
const CheckLabel = styled.label`
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  input {
    width: 20px;
    height: 20px;
    flex-shrink: 0;
  }
`
