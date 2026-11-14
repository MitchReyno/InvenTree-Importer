import type {
  BatchRecordDto,
  CaptureSnapshotDto,
  InventoryPartSpecDto,
  RecordOriginDto,
} from '@invimport/contracts'

type Parameter = InventoryPartSpecDto['parameters'][number]
type StepOrigin = Extract<RecordOriginDto, { kind: 'step' }>
type Said = Pick<StepOrigin, 'source_kind' | 'agreement'>

/** A value its step's sources disagree on: what it used, the others and why. */
export type MatrixConflict = {
  used: Said & { value: string }
  alternatives: NonNullable<StepOrigin['alternatives']>
  because?: string
  step: StepOrigin['step']
  /** What "Use <value>" sends back with the chosen alternative. */
  template: Parameter['template']
  categoryMapping: Parameter['category_mapping']
}

export type MatrixCell = {
  value?: string
  /** The parameter record to open for this Part and template. */
  recordKey?: string
  /** Another Part in the category has this template, or the category needs it, and this Part does not. */
  missing: boolean
  /** The operator set this value. */
  added: boolean
  /** The category needs this template; the step found no value for it. */
  required?: boolean
  /** Why the step found no value, when it said. */
  reason?: string | null
  conflict?: MatrixConflict
}

export type MatrixGroup = {
  category: string
  templates: { pk: string; label: string; required?: boolean }[]
  rows: { partId: string; label: string; cells: Record<string, MatrixCell> }[]
}

/** Records › Parameters as one Part × template matrix per category, for the batch's new Parts. */
export function parameterMatrix(
  batch: CaptureSnapshotDto,
  records: BatchRecordDto[],
): MatrixGroup[] {
  const label = (id: string) => batch.observations.find((item) => item.id === id)?.label

  const parameterRecord = (partId: string, pk: string) =>
    records.find(
      (record) =>
        record.target?.kind === 'parameter' &&
        record.target.part_subject_id === partId &&
        record.target.template_pk === pk,
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
        })
      }
    }
    const cells: Record<string, MatrixCell> = {}
    for (const parameter of spec.parameters) {
      const record = parameterRecord(part.id, parameter.template.pk)
      const origin = record?.fields.find((field) => field.name === 'value')?.origin
      cells[parameter.template.pk] = {
        value: parameter.value,
        recordKey: record?.key,
        missing: false,
        added: record?.fields.some((field) => field.origin.kind === 'operator') ?? false,
        ...(origin?.kind === 'step' && origin.alternatives?.length
          ? { conflict: conflictOf(parameter, origin) }
          : {}),
      }
    }
    // Templates the category needs that the Part's step found no value for.
    const required = records.find(
      (item) => item.target?.kind === 'part' && item.target.part_subject_id === part.id,
    )?.required_missing
    for (const missing of required ?? []) {
      const known = group.templates.find((template) => template.pk === missing.template_pk)
      if (known) {
        known.required = true
      } else {
        group.templates.push({ pk: missing.template_pk, label: missing.name, required: true })
      }
      cells[missing.template_pk] ??= {
        missing: true,
        added: false,
        required: true,
        reason: missing.reason,
      }
    }
    group.rows.push({ partId: part.id, label: part.label, cells })
    groups.set(category, group)
  }

  for (const group of groups.values()) {
    for (const row of group.rows) {
      for (const template of group.templates) {
        row.cells[template.pk] ??= {
          missing: true,
          added: false,
          ...(template.required ? { required: true } : {}),
        }
      }
    }
  }

  return [...groups.values()]
}

function conflictOf(parameter: Parameter, origin: StepOrigin): MatrixConflict {
  return {
    used: {
      value: parameter.value,
      ...(origin.source_kind ? { source_kind: origin.source_kind } : {}),
    },
    alternatives: origin.alternatives!,
    ...(origin.chosen_because ? { because: origin.chosen_because } : {}),
    step: origin.step,
    template: parameter.template,
    categoryMapping: parameter.category_mapping,
  }
}
