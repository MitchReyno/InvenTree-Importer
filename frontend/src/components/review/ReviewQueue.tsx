import styled from 'styled-components'
import { color, radius, size, space, typeVar } from '../../theme/generated/tokens'
import { media } from '../ui/media'
import { hoverTransition } from '../ui/motion'
import { lotCrops } from '../../processing/proposed-lots'
import type {
  CaptureSnapshotDto,
  ManualWorkspaceDto,
  OperatorLotDto,
  OperatorReviewDto,
} from '@invimport/contracts'
import { Heading, Panel, Small } from '../ui/primitives'
import { display } from '../../capture/display'
import {
  GROUP_LABELS,
  GROUP_ORDER,
  matchesFilter,
  queueGroup,
  type LotIds,
  type QueueGroup,
  type ReviewFilter,
} from '../../operator/review-model'
import { Pill } from '../ui/Pill'
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
  questionLotIds?: LotIds,
): string[] {
  if (!operatorReview) {
    return batch.lots.filter((lot) => !lot.retired).map((lot) => lot.id)
  }
  const active = new Map(operatorReview.lots.map((lot) => [lot.lot_id, lot]))
  const lots = batch.lots.filter((lot) => {
    const operatorLot = active.get(lot.id)
    return (
      !lot.retired &&
      operatorLot !== undefined &&
      matchesFilter(operatorLot, filter, questionLotIds)
    )
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
            const current = focused === lot.id
            const cover = lotCrops(batch, lot, { width: 48, height: 48 })[0]
            return (
              <QueueRow key={lot.id} $current={current}>
                <Check>
                  <input
                    type="checkbox"
                    aria-label={`Select ${lot.label}`}
                    checked={selected.includes(lot.id)}
                    disabled={busy || batch.archived || Boolean(approved) || atCapacity}
                    onChange={() => toggle(lot.id)}
                  />
                </Check>
                <RowButton
                  type="button"
                  disabled={busy}
                  aria-label={`Show ${lot.label}`}
                  aria-describedby={`${lot.id}-state`}
                  aria-current={current ? 'true' : undefined}
                  onClick={() => inspect(lot.id)}
                >
                  <Thumb data-thumb aria-hidden="true">
                    {cover ? (
                      <img {...cover} loading="lazy" decoding="async" alt="" />
                    ) : (
                      <span>▧</span>
                    )}
                  </Thumb>
                  <RowBody>
                    <RowTitle>{lot.label}</RowTitle>
                    <Qty>{display(lot.quantity, batch, 'quantity')}</Qty>
                    <RowState id={`${lot.id}-state`}>
                      {lot.origin === 'agent' && (
                        <Pill tone={lot.operator_edited ? 'neutral' : 'acc'}>
                          {lot.operator_edited ? 'Edited' : 'AI-proposed'}
                        </Pill>
                      )}
                      {operatorLot ? (
                        <LotStatusChips lot={operatorLot} />
                      ) : (
                        <Small>{legacyStatus(approved, status?.reviewed)}</Small>
                      )}
                    </RowState>
                  </RowBody>
                </RowButton>
              </QueueRow>
            )
          })}
        </Group>
      ))}
    </Panel>
  )
}

const Group = styled.section`
  margin-top: ${space[6]};
`
const GroupTitle = styled.h3`
  margin: 0;
  font-size: 12px;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  color: ${color.muted};
`
/** The canvas's item row: the whole row opens the lot; the checkbox sits beside it. */
const QueueRow = styled.div<{ $current: boolean }>`
  display: flex;
  align-items: stretch;
  gap: ${space[2]};
  margin-top: ${space[2]};
  border: 1px solid ${(p) => (p.$current ? color.accent : 'transparent')};
  border-radius: ${radius.btn};
  background: ${(p) => (p.$current ? color.accentWeak : 'transparent')};
  ${hoverTransition}
  &:hover {
    background: ${(p) => (p.$current ? color.accentWeak : color.surface2)};
  }
`
const Check = styled.label`
  display: flex;
  align-items: center;
  padding-left: ${space[4]};
  cursor: pointer;
  ${media.compact} {
    min-width: ${size.touch};
    justify-content: center;
    padding-left: 0;
  }
`
const RowButton = styled.button`
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: ${space[5]};
  flex: 1;
  min-width: 0;
  padding: 7px ${space[4]};
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  &:disabled {
    cursor: default;
  }
`
const Thumb = styled.span`
  display: grid;
  place-items: center;
  /* literal-allowed: the canvas's square row thumbnail; no thumbnail size token */
  width: 48px;
  height: 48px;
  overflow: hidden;
  border: 1px solid ${color.line};
  border-radius: ${radius.thumb};
  background: ${color.photoStage};
  color: ${color.photoFg};
  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
`
const RowBody = styled.span`
  display: grid;
  gap: ${space[1]};
  min-width: 0;
`
const RowTitle = styled.strong`
  overflow: hidden;
  font-size: ${typeVar.bodyStrong.size};
  font-weight: ${typeVar.bodyStrong.weight};
  text-overflow: ellipsis;
  white-space: nowrap;
`
const RowState = styled.span`
  display: flex;
  flex-wrap: wrap;
  gap: ${space[2]};
  /* A long state wraps inside the narrow queue rather than overflowing it. */
  [data-tone] {
    max-width: 100%;
    white-space: normal;
  }
`
const Qty = styled.span`
  color: ${color.muted};
  font-size: ${typeVar.small.size};
`
