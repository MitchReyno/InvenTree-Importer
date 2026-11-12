import { useContext, useId } from 'react'
import styled from 'styled-components'
import type { BatchRecordDto, CaptureSnapshotDto, SourceKindDto } from '@invimport/contracts'
import { parameterMatrix, type MatrixConflict } from '#/records/parameter-matrix'
import { STEP_LABELS } from '#/records/model'
import { color, font, radius, space, type, typeVar } from '#/theme/generated/tokens'
import { Button, Pill, Small, VisuallyHidden } from '#/components/ui'
import { AskControl } from './AskControl'
import { useRecordSave, type Save } from './draft'
import { SavingContext } from '#/context'

type Send = (text: string, key: string) => Promise<void>

type Props = {
  batch: CaptureSnapshotDto
  records: BatchRecordDto[]
  open: (key: string) => void
  /** Applies "Use <value>" as the parameter's record edit. */
  edit?: Save
  /** The proposing step's session for a record, when one will read a message. */
  ask?: (record: BatchRecordDto, step: string) => Send | undefined
  /** Records are stale, refreshing or archived, so nothing here may save. */
  disabled?: boolean
  /** Registers an unsent conflict question with the page's navigation guard. */
  reportFor?: (source: string) => (dirty: boolean) => void
}

const SOURCE_PHRASE: Record<SourceKindDto, string> = {
  label: 'the label',
  packing_slip: 'the packing slip',
  handwriting: 'the handwriting',
  distributor_page: 'a distributor page',
}

/** "the label says 25 V; a distributor page says 35 V." */
function disagreement(conflict: MatrixConflict) {
  const says = (value: string, kind: SourceKindDto | undefined, first: boolean) =>
    `${kind ? SOURCE_PHRASE[kind] : first ? 'one source' : 'another source'} says ${value}`

  return [
    says(conflict.used.value, conflict.used.source_kind, true),
    ...conflict.alternatives.map((other) => says(other.value, other.source_kind, false)),
  ].join('; ')
}

/** Each category's new Parts against its templates; a cell opens that parameter's record. */
export function ParameterMatrix({
  batch,
  records,
  open,
  edit,
  ask,
  disabled = false,
  reportFor,
}: Props) {
  const ids = useId()
  const groups = parameterMatrix(batch, records)
  if (!groups.length) {
    return null
  }
  return (
    <Matrix aria-label="Parameters by category">
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
                      {template.label}
                      {template.required && (
                        <>
                          {' '}
                          <Pill tone="warn" glyph="!">
                            Required here
                          </Pill>
                        </>
                      )}
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
                        const why = `${ids}-${row.partId}-${template.pk}`
                        return (
                          <td
                            key={template.pk}
                            data-missing
                            aria-describedby={cell.reason ? why : undefined}
                          >
                            {cell.required ? '! missing' : 'missing'}
                            {cell.reason && <VisuallyHidden id={why}>{cell.reason}</VisuallyHidden>}
                          </td>
                        )
                      }
                      return (
                        <td key={template.pk} data-added={cell.added || undefined}>
                          {cell.recordKey ? (
                            <Button
                              size="sm"
                              variant="link"
                              aria-label={`${row.label}, ${template.label}: ${cell.value}${cell.conflict ? ', sources disagree' : ''}`}
                              onClick={() => open(cell.recordKey!)}
                            >
                              {cell.value}
                              {cell.conflict && <Conflict aria-hidden="true"> ◆</Conflict>}
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
          {group.rows.flatMap((row) =>
            group.templates.flatMap((template) => {
              const cell = row.cells[template.pk]
              const conflict = cell.conflict
              if (!conflict) {
                return []
              }
              const record = records.find((item) => item.key === cell.recordKey)
              const send = record ? ask?.(record, conflict.step) : undefined
              const step = STEP_LABELS[conflict.step]
              return [
                <ConflictRow
                  key={`${row.partId}:${template.pk}`}
                  role="group"
                  aria-label={`${row.label} ${template.label}: sources disagree`}
                >
                  <span>
                    <span aria-hidden="true">◆ </span>
                    {row.label} {template.label}: {disagreement(conflict)}.
                    {conflict.because && ` ${conflict.because}`}
                  </span>
                  {edit && (
                    <ConflictChoices
                      batch={batch}
                      save={edit}
                      disabled={disabled}
                      values={conflict.alternatives.map((other) => other.value)}
                      change={(value) => ({
                        kind: 'record',
                        target: {
                          kind: 'parameter',
                          part_subject_id: row.partId,
                          template_pk: template.pk,
                        },
                        operation: {
                          op: 'set_parameter',
                          template: conflict.template,
                          category_mapping: conflict.categoryMapping,
                          value,
                        },
                      })}
                    />
                  )}
                  {send && record && (
                    <AskControl
                      step={step}
                      value={cell.value ?? null}
                      prefill={`The sources disagree on the ${template.label.toLowerCase()} of ${row.label}; please check which is right.`}
                      send={send}
                      storeKey={`${batch.id}:ask:${record.key}:conflict`}
                      report={reportFor?.(`matrix:${record.key}:conflict`)}
                    />
                  )}
                </ConflictRow>,
              ]
            }),
          )}
        </Group>
      ))}
      <Small>
        <Added>underline</Added>: your edit · ◆ sources disagree · missing: another Part in the
        category has this template · ! missing: the category needs it.
      </Small>
    </Matrix>
  )
}

/** "Use <value>" for each alternative, through the checked record save. */
function ConflictChoices({
  batch,
  save,
  disabled,
  values,
  change,
}: {
  batch: CaptureSnapshotDto
  save: Save
  disabled: boolean
  values: string[]
  change: (value: string) => Parameters<Save>[0]
}) {
  const { send, busy, problem, retry } = useRecordSave(batch, save)
  const { saving } = useContext(SavingContext)
  return (
    <>
      {values.map((value) => (
        <Button
          key={value}
          size="sm"
          variant="link"
          disabled={disabled || busy || saving}
          onClick={() => void send(change(value))}
        >
          Use {value}
        </Button>
      ))}
      {problem && <span role="alert">{problem}</span>}
      {retry && (
        <Button size="sm" variant="ghost" onClick={() => void retry()}>
          Load current values
        </Button>
      )}
    </>
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
const Conflict = styled.span`
  color: ${color.warn};
`
const ConflictRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[3]} ${space[5]};
  padding: ${space[4]} ${space[5]};
  border-radius: ${radius.card};
  background: ${color.warnWeak};
  font-size: ${typeVar.small.size};
`
const Added = styled.span`
  text-decoration: underline;
  text-decoration-color: ${color.accent};
  text-decoration-thickness: 2px;
`
