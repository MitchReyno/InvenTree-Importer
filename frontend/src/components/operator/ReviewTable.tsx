import styled from 'styled-components'
import { color, size, space, typeVar } from '../../theme/generated/tokens'
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
import { DataTable, type DataColumn, type DataRow } from '../ui/DataTable'

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

const COLUMNS: DataColumn[] = [
  { id: 'status', header: 'Status', nowrap: true },
  { id: 'problems', header: 'Problems' },
  { id: 'item', header: 'Item' },
  { id: 'qty', header: 'Qty', nowrap: true },
  { id: 'location', header: 'Location' },
  { id: 'part', header: 'Part' },
]

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
  const rows: DataRow[] = lots.map((lot) => {
    const capture = batch.lots.find((value) => value.id === lot.lot_id)!
    const location = lotLocationFact(batch, capture, media)
    const part = partCell(batch, lot)
    return {
      id: lot.lot_id,
      label: lot.label,
      cells: {
        status: { value: '', content: <ReviewStateChip lot={lot} /> },
        problems: { value: '', content: <Problems lot={lot} /> },
        item: {
          value: lot.label,
          content: (
            <ItemButton type="button" onClick={() => inspect(lot.lot_id)}>
              {lot.label}
            </ItemButton>
          ),
        },
        qty: { value: display(capture.quantity, batch, 'quantity') },
        location: {
          value: `${location.value} · ${PROVENANCE_LABELS[location.provenance]}`,
        },
        part: {
          value: part,
          content: (
            <>
              {part}
              {lot.shared_lot_ids.length > 0 && (
                <SharedCount> ×{lot.shared_lot_ids.length + 1} lots</SharedCount>
              )}
            </>
          ),
        },
      },
    }
  })
  return (
    <>
      <DataTable
        caption="Lots in this filter. Select rows to act on several at once."
        region="Lot table"
        onRowOpen={inspect}
        columns={COLUMNS}
        rows={rows}
        selection={{
          selected,
          disabled,
          onToggle: toggle,
          onToggleAll: () => toggleAll(lots.map((lot) => lot.lot_id)),
        }}
      />
      {!lots.length && <Empty>No lots match this filter.</Empty>}
    </>
  )
}

const ProblemList = styled.span`
  display: flex;
  flex-wrap: wrap;
  gap: ${space[2]};
`
/** Plain text that opens the lot, so the row stays reachable by keyboard. */
const ItemButton = styled.button`
  padding: 0;
  border: 0;
  background: none;
  color: ${color.fg};
  text-align: left;
  font: inherit;
  font-weight: ${typeVar.bodyStrong.weight};
  cursor: pointer;
  min-height: ${size.control};
  &:hover {
    text-decoration: underline;
  }
`
const SharedCount = styled.span`
  color: ${color.muted};
  font-size: ${typeVar.small.size};
`
const Empty = styled.p`
  padding: ${space[6]};
  color: ${color.muted};
`
