import type {
  CaptureAssignedLocationChangeDto,
  CaptureEditDto,
  CaptureLotContextDto,
  InventoryPartSpecDto,
} from '@invimport/contracts'
import type { Snapshot, Quantity, Reference } from './types'

import { captureContext, normalizeContextTags } from './context'

const empty = { mode: 'unset' } as const

export type CaptureEditorValues = {
  captureContext: CaptureLotContextDto
  label: string
  quantity: Quantity
  location: Reference
  choice: Reference
  partLocation: CaptureAssignedLocationChangeDto
  partMode: 'reuse' | 'create'
  partName: string
  categoryId: string
  parameters: { templateId: string; mappingId: string; value: string }[]
  manufacturerId: string
  mpn: string
  supplierId: string
  sku: string
  tags: string
  partId: string
  text: string
}

export function captureEditorDefaults(batch: Snapshot, selected: string): CaptureEditorValues {
  const lot = batch.lots.find((candidate) => candidate.id === selected)
  const part = batch.parts.find((candidate) => candidate.id === selected)

  const spec = part?.choice.mode === 'create' ? part.choice.spec : null
  return {
    captureContext: captureContext(batch, lot?.id ?? null),
    partMode: spec ? 'create' : 'reuse',
    partName: spec?.name ?? '',
    categoryId: spec?.category.observation_id ?? '',
    parameters:
      spec?.parameters.map((parameter) => ({
        templateId: parameter.template.observation_id,
        mappingId: parameter.category_mapping.observation_id,
        value: parameter.value,
      })) ?? [],
    manufacturerId: spec?.manufacturer?.company.observation_id ?? '',
    mpn: spec?.manufacturer?.mpn ?? '',
    supplierId: spec?.supplier?.company.observation_id ?? '',
    sku: spec?.supplier?.sku ?? '',
    tags: spec?.tags.join(', ') ?? '',
    label: lot?.label ?? part?.label ?? '',
    quantity: lot?.quantity ?? empty,
    location: lot?.location ?? empty,
    choice: part?.choice.mode === 'create' ? empty : (part?.choice ?? empty),
    partLocation: part?.location ?? empty,
    partId: lot?.part_subject_id ?? '',
    text: '',
  }
}

export function captureEditorChange(
  batch: Snapshot,
  selected: string,
  values: CaptureEditorValues,
): CaptureEditDto['change'] {
  const lot = batch.lots.find((candidate) => candidate.id === selected)
  const part = batch.parts.find((candidate) => candidate.id === selected)
  const { label, quantity, location, choice, partId, text } = values

  if (lot) {
    const context = normalizeContextTags(values.captureContext)
    return {
      kind: 'lot',
      id: lot.id,
      label,
      part_subject_id: partId || null,
      quantity,
      location,
      ...(JSON.stringify(context) !== JSON.stringify(captureContext(batch, lot.id))
        ? { context }
        : {}),
    }
  }
  if (part) {
    // Only a changed assignment is retained, so ordinary Part edits add no location history.
    const location =
      JSON.stringify(values.partLocation) !== JSON.stringify(part.location ?? empty)
        ? { location: values.partLocation }
        : {}
    return {
      kind: 'part',
      id: part.id,
      label,
      ...location,
      choice:
        values.partMode === 'create'
          ? { mode: 'create', spec: partSpecFromValues(batch, values) }
          : choice.mode === 'inherit'
            ? empty
            : choice,
    }
  }
  if (selected === 'add_part') {
    return { kind: 'add_part', label }
  }
  if (selected === 'add_lot') {
    return { kind: 'add_lot', label, note: text, part_subject_id: partId || null }
  }
  throw new Error('capture_subject_not_selected')
}

export function partSpecFromValues(
  batch: Snapshot,
  values: CaptureEditorValues,
): InventoryPartSpecDto {
  function reference<
    M extends 'category' | 'parameter_template' | 'category_parameter' | 'company',
  >(id: string, model: M) {
    const observed = batch.observations.find((item) => item.id === id && item.model === model)
    if (!observed) {
      throw new Error('Read and select each mapped record before saving.')
    }
    return {
      observation_id: observed.id,
      target_context_id: observed.target_context_id,
      model,
      pk: observed.pk,
    }
  }

  return {
    name: values.partName,
    category: reference(values.categoryId, 'category'),
    parameters: values.parameters.map((parameter) => ({
      template: reference(parameter.templateId, 'parameter_template'),
      category_mapping: reference(parameter.mappingId, 'category_parameter'),
      value: parameter.value,
    })),
    manufacturer: values.manufacturerId
      ? { company: reference(values.manufacturerId, 'company'), mpn: values.mpn }
      : null,
    supplier: values.supplierId
      ? { company: reference(values.supplierId, 'company'), sku: values.sku }
      : null,
    tags: values.tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
  }
}
