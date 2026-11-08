import type { BatchRecordDto, CaptureSnapshotDto } from '@invimport/contracts'

export type MatrixCell = {
  value?: string
  /** The parameter record to open for this Part and template. */
  recordKey?: string
  /** Another Part in the category has this template and this Part does not. */
  missing: boolean
  /** The operator set this value. */
  added: boolean
}

export type MatrixGroup = {
  category: string
  templates: { pk: string; label: string; isNew: boolean }[]
  rows: { partId: string; label: string; cells: Record<string, MatrixCell> }[]
}

/**
 * Records › Parameters as one Part × template matrix per category, for the batch's new Parts.
 * Source conflicts and required-here markers need per-value alternatives (task 23.3).
 */
export function parameterMatrix(batch: CaptureSnapshotDto, records: BatchRecordDto[]) {
  const label = (id: string) => batch.observations.find((item) => item.id === id)?.label

  const parameterRecord = (partId: string, pk: string) =>
    records.find(
      (record) =>
        record.target?.kind === 'parameter' &&
        record.target.part_subject_id === partId &&
        record.target.template_pk === pk,
    )

  const templateRecords = records.filter((record) => record.target?.kind === 'parameter_template')

  const isNew = (pk: string) =>
    templateRecords.some(
      (record) =>
        record.target?.kind === 'parameter_template' &&
        record.target.pk === pk &&
        record.state !== 'exists',
    )

  const groups = new Map<string, MatrixGroup>()
  for (const part of batch.parts) {
    if (part.choice.mode !== 'create') {
      continue
    }
    const { spec } = part.choice
    const category = spec.category.pk
    const group = groups.get(category) ?? {
      category: label(spec.category.observation_id) ?? `Category #${category}`,
      templates: [],
      rows: [],
    }
    for (const parameter of spec.parameters) {
      const pk = parameter.template.pk
      if (!group.templates.some((template) => template.pk === pk)) {
        group.templates.push({
          pk,
          label: label(parameter.template.observation_id) ?? `Template #${pk}`,
          isNew: isNew(pk),
        })
      }
    }
    const cells: Record<string, MatrixCell> = {}
    for (const parameter of spec.parameters) {
      const record = parameterRecord(part.id, parameter.template.pk)
      cells[parameter.template.pk] = {
        value: parameter.value,
        recordKey: record?.key,
        missing: false,
        added: record?.fields.some((field) => field.origin.kind === 'operator') ?? false,
      }
    }
    group.rows.push({ partId: part.id, label: part.label, cells })
    groups.set(category, group)
  }

  for (const group of groups.values()) {
    for (const row of group.rows) {
      for (const template of group.templates) {
        row.cells[template.pk] ??= { missing: true, added: false }
      }
    }
  }

  return {
    groups: [...groups.values()],
    toDecide: templateRecords.filter((record) => record.state === 'choose'),
  }
}
