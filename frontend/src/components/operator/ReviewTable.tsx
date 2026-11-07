import styled from 'styled-components'
import { color, size, space } from '../../theme/generated/tokens'
import type {
  CaptureSnapshotDto,
  MediaSnapshotDto,
  OperatorLotDto,
  OperatorReviewDto,
} from '@invimport/contracts'
import { display } from '../../capture/display'
import {
  PROVENANCE_LABELS,
  blockingIssues,
  lotLocationFact,
  openWarnings,
} from '../../operator/review-model'
import { Pill } from '../ui/Pill'

export interface ReviewTableProps {
  batch: CaptureSnapshotDto
  review: OperatorReviewDto
  /** Evidence group membership for group location assignments; undefined while unread. */
  media?: Pick<MediaSnapshotDto, 'evidence' | 'groups'>
  lotIds: string[]
  selected: ReadonlySet<string>
  disabled: boolean
  toggle: (lotId: string) => void
  toggleAll: (lotIds: string[]) => void
  inspect: (lotId: string) => void
}

function ReviewStateChip({ lot }: { lot: OperatorLotDto }) {
  if (lot.approved) {
    return <Pill tone="ok">Approved</Pill>
  }
  if (lot.review_state === 'reviewed') {
    return <Pill status="ready">Reviewed</Pill>
  }
  if (lot.review_state === 'changed_after_review') {
    return <Pill status="warning">Changed</Pill>
  }
  return <Pill tone="neutral">Needs review</Pill>
}

function Problems({ lot }: { lot: OperatorLotDto }) {
  const blocking = blockingIssues(lot).length
  const warnings = openWarnings(lot).length
  if (!blocking && !warnings) {
    return <span>None</span>
  }
  return (
    <ProblemList>
      {blocking > 0 && <Pill status="blocking">{blocking} blocking</Pill>}
      {warnings > 0 && (
        <Pill status="warning">
          {warnings} warning{warnings === 1 ? '' : 's'}
        </Pill>
      )}
    </ProblemList>
  )
}

function partCell(batch: CaptureSnapshotDto, lot: OperatorLotDto) {
  const part = batch.parts.find((value) => value.id === lot.part_subject_id)
  if (!part) {
    return 'No Part proposal'
  }
  const chosen = part.choice.mode === 'set' ? ` · #${part.choice.value.pk}` : ' · not chosen'
  return `${part.label}${chosen}`
}

/** A second projection of the same retained facts; selection here is explicit and per row. */
export function ReviewTable({
  batch,
  review,
  media,
  lotIds,
  selected,
  disabled,
  toggle,
  toggleAll,
  inspect,
}: ReviewTableProps) {
  const lots = lotIds
    .map((id) => review.lots.find((lot) => lot.lot_id === id))
    .filter((lot): lot is OperatorLotDto => lot !== undefined)
  const allSelected = lots.length > 0 && lots.every((lot) => selected.has(lot.lot_id))
  return (
    <Scroll role="region" aria-label="Lot table" tabIndex={0}>
      <Table>
        <caption>
          Select rows to edit several at once. Per-lot overrides show as Override in the evidence
          view.
        </caption>
        <thead>
          <tr>
            <th scope="col">
              <input
                type="checkbox"
                aria-label="Select all shown lots"
                checked={allSelected}
                disabled={disabled || !lots.length}
                onChange={() => toggleAll(lots.map((lot) => lot.lot_id))}
              />
            </th>
            <th scope="col">Status</th>
            <th scope="col">Problems</th>
            <th scope="col">Item</th>
            <th scope="col">Qty</th>
            <th scope="col">Location</th>
            <th scope="col">Part</th>
          </tr>
        </thead>
        <tbody>
          {lots.map((lot) => {
            const capture = batch.lots.find((value) => value.id === lot.lot_id)!
            const location = lotLocationFact(batch, capture, media)
            return (
              <tr key={lot.lot_id} aria-selected={selected.has(lot.lot_id)}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Select ${lot.label}`}
                    checked={selected.has(lot.lot_id)}
                    disabled={disabled}
                    onChange={() => toggle(lot.lot_id)}
                  />
                </td>
                <td>
                  <ReviewStateChip lot={lot} />
                </td>
                <td>
                  <Problems lot={lot} />
                </td>
                <td>
                  <ItemButton type="button" onClick={() => inspect(lot.lot_id)}>
                    {lot.label}
                  </ItemButton>
                </td>
                <td>{display(capture.quantity, batch, 'quantity')}</td>
                <td>
                  {location.value} · {PROVENANCE_LABELS[location.provenance]}
                </td>
                <td>
                  {partCell(batch, lot)}
                  {lot.shared_lot_ids.length > 0 && (
                    <SharedCount> ×{lot.shared_lot_ids.length + 1} lots</SharedCount>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </Table>
      {!lots.length && <Empty>No lots match this filter.</Empty>}
    </Scroll>
  )
}

const Scroll = styled.div`
  overflow-x: auto;
  max-width: 100%;
  background: ${color.surface};
  border: 1px solid ${color.line};
  border-radius: 6px;
  &:focus-visible {
    outline: 3px solid ${color.accent};
  }
`
const Table = styled.table`
  border-collapse: collapse;
  width: 100%;
  min-width: 860px;
  caption {
    padding: ${space[5]} ${space[6]};
    text-align: left;
    color: ${color.muted};
    font-size: 13px;
  }
  th,
  td {
    padding: ${space[5]} ${space[6]};
    text-align: left;
    vertical-align: top;
    border-top: 1px solid ${color.line};
  }
  thead th {
    font-size: 12px;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: ${color.muted};
  }
  tr[aria-selected='true'] td {
    background: ${color.accentWeak};
  }
  input[type='checkbox'] {
    width: 20px;
    height: 20px;
  }
`
const ProblemList = styled.span`
  display: flex;
  flex-wrap: wrap;
  gap: ${space[2]};
`
const ItemButton = styled.button`
  padding: 0;
  border: 0;
  background: none;
  color: ${color.accent};
  text-decoration: underline;
  text-align: left;
  font: inherit;
  cursor: pointer;
  min-height: ${size.control};
`
const SharedCount = styled.span`
  color: ${color.muted};
  font-size: 13px;
`
const Empty = styled.p`
  padding: ${space[6]};
  color: ${color.muted};
`
