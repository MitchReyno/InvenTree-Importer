import styled from 'styled-components'
import type { BatchRecordDto, CaptureSnapshotDto } from '@invimport/contracts'
import { parameterMatrix } from '../../../records/parameter-matrix'
import { color, font, radius, space, type, typeVar } from '../../../theme/generated/tokens'
import { Button } from '../../ui/Button'
import { Small } from '../../ui/primitives'
import { VisuallyHidden } from '../../ui/VisuallyHidden'

type Props = {
  batch: CaptureSnapshotDto
  records: BatchRecordDto[]
  open: (type: 'parameter' | 'parameter_template', key: string) => void
}

/** Each category's new Parts against its templates; a cell opens that parameter's record. */
export function ParameterMatrix({ batch, records, open }: Props) {
  const { groups, toDecide } = parameterMatrix(batch, records)
  if (!groups.length && !toDecide.length) {
    return null
  }
  return (
    <Matrix aria-label="Parameters by category">
      {toDecide.length > 0 && (
        <Decide aria-label="New parameter templates">
          <strong>New parameter templates · {toDecide.length} to decide</strong>
          {toDecide.map((record) => (
            <Button
              key={record.key}
              size="sm"
              variant="link"
              onClick={() => open('parameter_template', record.key)}
            >
              {record.label}
            </Button>
          ))}
        </Decide>
      )}
      {groups.map((group) => (
        <Group key={group.category}>
          <GroupTitle>{group.category}</GroupTitle>
          <Scroll>
            <Table>
              <VisuallyHidden as="caption">
                {group.category}: each new Part against its parameter templates
              </VisuallyHidden>
              <thead>
                <tr>
                  <th scope="col">Part</th>
                  {group.templates.map((template) => (
                    <th key={template.pk} scope="col">
                      {template.isNew && <span aria-hidden="true">＋ </span>}
                      {template.label}
                      {template.isNew && <VisuallyHidden> (new template)</VisuallyHidden>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {group.rows.map((row) => (
                  <tr key={row.partId}>
                    <th scope="row">{row.label}</th>
                    {group.templates.map((template) => {
                      const cell = row.cells[template.pk]
                      if (cell.missing) {
                        return (
                          <td key={template.pk} data-missing>
                            missing
                          </td>
                        )
                      }
                      return (
                        <td key={template.pk} data-added={cell.added || undefined}>
                          {cell.recordKey ? (
                            <Button
                              size="sm"
                              variant="link"
                              aria-label={`${row.label}, ${template.label}: ${cell.value}`}
                              onClick={() => open('parameter', cell.recordKey!)}
                            >
                              {cell.value}
                            </Button>
                          ) : (
                            cell.value
                          )}
                          {cell.added && <VisuallyHidden> (your edit)</VisuallyHidden>}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </Table>
          </Scroll>
        </Group>
      ))}
      <Small>
        ＋ new template · <Added>underline</Added>: your edit · missing: another Part in the
        category has this template. Source conflicts arrive with per-value alternatives.
      </Small>
    </Matrix>
  )
}

const Matrix = styled.section`
  display: grid;
  gap: ${space[5]};
  padding: ${space[7]} ${space[8]};
  border: 1px solid ${color.line};
  border-radius: ${radius.card};
  background: ${color.surface};
`
const Decide = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[3]} ${space[5]};
  padding: ${space[5]} ${space[6]};
  border-radius: ${radius.btn};
  background: ${color.warnWeak};
`
const Group = styled.div`
  display: grid;
  gap: ${space[3]};
`
const GroupTitle = styled.h3`
  margin: 0;
  ${type.label}
  color: ${color.muted};
`
const Scroll = styled.div`
  overflow-x: auto;
`
const Table = styled.table`
  border-collapse: collapse;
  font-size: ${typeVar.small.size};
  th,
  td {
    padding: ${space[3]} ${space[5]};
    border-bottom: 1px solid ${color.line};
    text-align: left;
    white-space: nowrap;
  }
  thead th {
    background: ${color.surface2};
    color: ${color.muted};
  }
  td {
    font-family: ${font.mono};
  }
  td[data-missing] {
    color: ${color.warn};
    font-family: inherit;
  }
  /* Values open their record; only the operator's own value is underlined. */
  td button {
    color: ${color.fg};
    font-family: inherit;
    text-decoration: none;
  }
  td button:hover {
    text-decoration: underline;
  }
  td[data-added] button {
    text-decoration: underline;
    text-decoration-color: ${color.accent};
    text-decoration-thickness: 2px;
  }
`
const Added = styled.span`
  text-decoration: underline;
  text-decoration-color: ${color.accent};
  text-decoration-thickness: 2px;
`
