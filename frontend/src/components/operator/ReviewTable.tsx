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
  blockingIssues,
  lotLocationFact,
  lotProvenance,
  openWarnings,
  type Provenance,
} from '../../operator/review-model'
import { partFacts } from '../../operator/part-facts'
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

/** One state per lot, most pressing first; Excluded follows the Exclude command (task 22.4). */
function LotState({ lot }: { lot: OperatorLotDto }) {
  const blocking = blockingIssues(lot).length
  const warnings = openWarnings(lot).length
  if (lot.approved) {
    return <Pill tone="ok">Approved</Pill>
  }
  if (blocking) {
    return <Pill status="blocking">{blocking} blocking</Pill>
  }
  if (warnings) {
    return (
      <Pill status="warning">
        {warnings} warning{warnings === 1 ? '' : 's'}
      </Pill>
    )
  }
  if (lot.review_state === 'changed_after_review') {
    return <Pill status="warning">Changed</Pill>
  }
  if (lot.review_state === 'reviewed') {
    return <Pill status="ready">Reviewed</Pill>
  }
  return <Pill tone="neutral">Needs review</Pill>
}

/** ◆ marks a lot value that overrides the batch; an underline marks the operator's own edit. */
function markers(provenance: Provenance) {
  return { override: provenance === 'override', edited: provenance === 'human' }
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
  { id: 'state', header: 'State', nowrap: true },
  { id: 'item', header: 'Item' },
  { id: 'mpn', header: 'MPN', mono: true },
  { id: 'dateCode', header: 'D/C', mono: true, nowrap: true },
  { id: 'sku', header: 'Supplier SKU', mono: true },
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
    const facts = partFacts(
      batch,
      batch.parts.find((value) => value.id === lot.part_subject_id),
    )
    return {
      id: lot.lot_id,
      label: lot.label,
      cells: {
        state: { value: '', content: <LotState lot={lot} /> },
        mpn: { value: facts.mpn ?? '' },
        dateCode: { value: facts.dateCode ?? '' },
        sku: { value: facts.supplierSku ?? '' },
        item: {
          value: lot.label,
          content: (
            <ItemButton type="button" onClick={() => inspect(lot.lot_id)}>
              {lot.label}
            </ItemButton>
          ),
        },
        qty: {
          value: display(capture.quantity, batch, 'quantity'),
          ...markers(lotProvenance(capture.quantity, batch.defaults.quantity)),
        },
        location: { value: location.value, ...markers(location.provenance) },
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
      <Legend>
        <span aria-hidden="true">◆</span> overrides the batch value · <Edited>underline</Edited>:
        your edit
      </Legend>
    </>
  )
}

const Legend = styled.p`
  margin: ${space[3]} 0 0;
  color: ${color.muted};
  font-size: ${typeVar.small.size};
`
const Edited = styled.span`
  text-decoration: underline;
  text-decoration-color: ${color.accent};
  text-decoration-thickness: 2px;
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
