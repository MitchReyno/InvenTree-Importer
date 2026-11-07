import { useEffect, useRef, type ReactNode } from 'react'
import styled, { css } from 'styled-components'
import { color, font, radius, size, space, type, typeVar } from '../../theme/generated/tokens'
import { InlineEdit } from './InlineEdit'
import { media } from './media'
import { VisuallyHidden } from './VisuallyHidden'
import { hoverTransition } from './motion'

/** `nowrap` keeps a short label column (a step or a state) from breaking inside a word. */
export type DataColumn = {
  id: string
  header: string
  editable?: boolean
  mono?: boolean
  nowrap?: boolean
}

/** `content` shows in place of the plain value, e.g. a status pill. */
export type DataCell = { value: string; content?: ReactNode; override?: boolean; edited?: boolean }

export type DataRow = { id: string; label: string; cells: Record<string, DataCell> }

export type TableSelection = {
  selected: ReadonlySet<string>
  onToggle: (rowId: string) => void
  onToggleAll: () => void
  disabled?: boolean
}

type DataTableProps = {
  caption: string
  columns: DataColumn[]
  rows: DataRow[]
  selection?: TableSelection
  onCellEdit?: (rowId: string, columnId: string, value: string) => void
  /** Names the scroll container as a region keyboard users can focus and scroll. */
  region?: string
}

function SelectAll({ rows, selection }: { rows: DataRow[]; selection: TableSelection }) {
  const box = useRef<HTMLInputElement>(null)
  const count = rows.filter((row) => selection.selected.has(row.id)).length
  const all = rows.length > 0 && count === rows.length

  useEffect(() => {
    if (box.current) {
      box.current.indeterminate = count > 0 && !all
    }
  }, [count, all])

  return (
    <Hit>
      <input
        ref={box}
        type="checkbox"
        aria-label="Select all rows"
        checked={all}
        disabled={selection.disabled || rows.length === 0}
        onChange={selection.onToggleAll}
      />
    </Hit>
  )
}

function CellContent({ cell, mono }: { cell: DataCell; mono: boolean }) {
  if (cell.content !== undefined) {
    return <>{cell.content}</>
  }
  return (
    <CellText $override={cell.override ?? false} $edited={cell.edited ?? false} $mono={mono}>
      {cell.override && <span aria-hidden="true">◆ </span>}
      {cell.value}
      {cell.override && <VisuallyHidden> overrides batch</VisuallyHidden>}
      {cell.edited && <VisuallyHidden> edited</VisuallyHidden>}
    </CellText>
  )
}

/** A scrolling table; ◆ marks an override and an underline marks an edit, both also in words. */
export function DataTable({
  caption,
  columns,
  rows,
  selection,
  onCellEdit,
  region,
}: DataTableProps) {
  return (
    <TableWrap {...(region && { role: 'region', 'aria-label': region, tabIndex: 0 })}>
      <Table>
        <VisuallyHidden as="caption">{caption}</VisuallyHidden>
        <thead>
          <tr>
            {selection && (
              <th scope="col">
                <SelectAll rows={rows} selection={selection} />
              </th>
            )}
            {columns.map((column) => (
              <th key={column.id} scope="col">
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const selected = selection?.selected.has(row.id) ?? false

            return (
              <tr key={row.id} data-selected={selected}>
                {selection && (
                  <td>
                    <Hit>
                      <input
                        type="checkbox"
                        aria-label={`Select ${row.label}`}
                        checked={selected}
                        disabled={selection.disabled}
                        onChange={() => selection.onToggle(row.id)}
                      />
                    </Hit>
                  </td>
                )}
                {columns.map((column) => {
                  const cell = row.cells[column.id] ?? { value: '' }
                  const mono = column.mono ?? false
                  const editable = column.editable && onCellEdit

                  return (
                    <td key={column.id} data-nowrap={column.nowrap || undefined}>
                      {editable ? (
                        <InlineEdit
                          label={column.header}
                          value={cell.value}
                          mono={mono}
                          onSave={(value) => onCellEdit(row.id, column.id, value)}
                        >
                          <CellContent cell={cell} mono={mono} />
                        </InlineEdit>
                      ) : (
                        <CellContent cell={cell} mono={mono} />
                      )}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </Table>
    </TableWrap>
  )
}

/** A checkbox's clickable area, 44px square below 760px. */
const Hit = styled.label`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  ${media.compact} {
    min-width: ${size.touch};
    min-height: ${size.touch};
  }
`

/** Horizontal scroll container so wide tables never widen the page. */
export const TableWrap = styled.div`
  overflow-x: auto;
  border: 1px solid ${color.line};
  border-radius: ${radius.card};
  background: ${color.surface};
`

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  th {
    ${type.label}
    letter-spacing: 0.05em;
    padding: ${space[4]} ${space[5]};
    border-bottom: 1px solid ${color.line};
    background: ${color.surface2};
    color: ${color.muted};
    text-align: left;
    white-space: nowrap;
  }
  td {
    padding: ${space[3]} ${space[5]};
    border-bottom: 1px solid ${color.line};
    vertical-align: middle;
    ${hoverTransition}
  }
  td[data-nowrap] {
    white-space: nowrap;
  }
  tbody tr:hover td {
    background: ${color.surface2};
  }
  tr[data-selected='true'] td {
    background: ${color.accentWeak};
  }
`

const CellText = styled.span<{ $override: boolean; $edited: boolean; $mono: boolean }>`
  overflow-wrap: anywhere;
  ${({ $mono }) =>
    $mono &&
    css`
      font-family: ${font.mono};
      font-size: ${typeVar.mono.size};
    `}
  ${({ $override }) =>
    $override &&
    css`
      color: ${color.warn};
      font-weight: 600;
    `}
  ${({ $edited }) =>
    $edited &&
    css`
      text-decoration: underline;
      text-decoration-color: ${color.accent};
      text-decoration-thickness: 2px;
    `}
`
