import type { ReactNode } from 'react'
import styled from 'styled-components'
import { color, radius, space, typeVar } from '#/theme/generated/tokens'
import { VisuallyHidden } from './VisuallyHidden'

export type CompareRow = {
  field: string
  values: [ReactNode, ReactNode]
  /** The two records disagree on this field. */
  differs?: boolean
}

type CompareTableProps = {
  caption: string
  /** The two records' column headings, such as "This batch" and the existing stock item. */
  records: [string, string]
  rows: CompareRow[]
}

/**
 * Two records side by side, to decide whether they are the same thing. A differing field is
 * tinted and also marked in the field column, so it never relies on colour.
 */
export function CompareTable({ caption, records, rows }: CompareTableProps) {
  return (
    <Wrap>
      <Table>
        <VisuallyHidden as="caption">{caption}</VisuallyHidden>
        <thead>
          <tr>
            <th scope="col">
              <VisuallyHidden>Field</VisuallyHidden>
            </th>
            <th scope="col">{records[0]}</th>
            <th scope="col">{records[1]}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.field}>
              <th scope="row">
                {row.field}
                {row.differs && (
                  <Differs>
                    <VisuallyHidden> differs</VisuallyHidden>
                    <span aria-hidden="true"> ≠</span>
                  </Differs>
                )}
              </th>
              {row.values.map((value, index) => (
                <td key={index} data-differs={row.differs || undefined}>
                  {value}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </Table>
    </Wrap>
  )
}

const Wrap = styled.div`
  overflow-x: auto;
  border: 1px solid ${color.line};
  border-radius: ${radius.card};
  background: ${color.surface};
`

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  th,
  td {
    padding: ${space[4]} ${space[5]};
    border-top: 1px solid ${color.line};
    text-align: left;
    vertical-align: top;
  }
  thead th {
    border-top: 0;
    background: ${color.surface2};
    font-size: ${typeVar.small.size};
    font-weight: ${typeVar.bodyStrong.weight};
  }
  tbody th {
    width: 120px;
    color: ${color.muted};
    font-size: ${typeVar.small.size};
    font-weight: ${typeVar.body.weight};
  }
  td[data-differs='true'] {
    background: ${color.warnWeak};
  }
`

const Differs = styled.span`
  color: ${color.warn};
  font-weight: ${typeVar.bodyStrong.weight};
`
