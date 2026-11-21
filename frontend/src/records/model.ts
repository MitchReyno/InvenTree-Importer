import {
  RecordEditError,
  applyRecordChange,
  recordScope,
  type BatchRecordDto,
  type CaptureObservationDto,
  type CaptureSnapshotDto,
  type RecordChangeDto,
  type RecordRefDto,
  type RecordTypeDto,
} from '@invimport/contracts'

export const TYPE_LABELS: Record<RecordTypeDto, string> = {
  category: 'Categories',
  company: 'Companies',
  part: 'Parts',
  manufacturer_part: 'Manufacturer parts',
  supplier_part: 'Supplier parts',
  parameter_template: 'Parameter templates',
  parameter: 'Parameters',
  location: 'Locations',
  stock_item: 'Stock items',
  tag: 'Tags',
}

export const STATE_LABELS: Record<BatchRecordDto['state'], string> = {
  new: 'New',
  exists: 'Exists',
  update: 'Update',
  choose: 'Needs a decision',
  unsupported: 'Not supported yet',
}

export const STEP_LABELS: Record<string, string> = {
  examine: 'Examine',
  research: 'Research',
  images: 'Images',
  inventory: 'Inventory',
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

export function partName(batch: CaptureSnapshotDto, partId: string) {
  const part = batch.parts.find((item) => item.id === partId)
  return part?.choice.mode === 'create' ? part.choice.spec.name : (part?.label ?? 'a Part')
}

/** What an edit to this record reaches, in words: "applies to RES-0144, used by 2 lots". */
export function scopeText(batch: CaptureSnapshotDto, target: RecordRefDto) {
  try {
    const scope = recordScope(batch, target)
    const parts =
      scope.partIds.length === 1
        ? partName(batch, scope.partIds[0])
        : `${scope.partIds.length} Parts (${scope.partIds.map((id) => partName(batch, id)).join(', ')})`
    return `Applies to ${parts}, used by ${plural(scope.lotIds.length, 'lot')}.`
  } catch {
    return 'This record is no longer in the batch.'
  }
}

const REFUSALS: Record<string, (part: string) => string> = {
  company_role_incompatible: () => 'That company is not observed in this role.',
  mapping_observation_invalid: () => 'Read that record again before using it.',
  parameter_category_incompatible: (part) =>
    `No category mapping fits “${part}”. Choose one for its category, or exclude that Part.`,
  parameter_mapping_required: (part) =>
    `Map or drop every parameter of “${part}” for the new category.`,
  duplicate_parameter_mapping: (part) => `“${part}” already has a parameter with that template.`,
  record_part_has_no_spec: (part) => `“${part}” needs a decision before it can be edited.`,
  record_scope_empty: () => 'Every Part is excluded, so nothing would change.',
  record_not_found: () => 'This record is no longer in the batch.',
}

/**
 * Checks an edit against the loaded batch before sending it, so a refusal can name the Part.
 * The server checks it again at the saved revision.
 */
export function refusal(batch: CaptureSnapshotDto, change: RecordChangeDto): string | null {
  try {
    applyRecordChange(batch, change)
    return null
  } catch (error) {
    if (!(error instanceof RecordEditError)) {
      throw error
    }
    const message = REFUSALS[error.code]
    const part = error.partId ? partName(batch, error.partId) : 'a Part'
    return message ? message(part) : 'This edit cannot be applied.'
  }
}

export type Observed<M extends CaptureObservationDto['model']> = CaptureObservationDto & {
  model: M
}

export function observed<M extends CaptureObservationDto['model']>(
  batch: CaptureSnapshotDto,
  model: M,
): Observed<M>[] {
  return batch.observations.filter(
    (item): item is Observed<M> => item.model === model && item.mapping?.kind === model,
  )
}

/** Templates a Part parameter can use: enabled, and for Parts or any model. */
export function partTemplates(batch: CaptureSnapshotDto) {
  return observed(batch, 'parameter_template').filter(
    (item) =>
      item.mapping?.kind === 'parameter_template' &&
      item.mapping.enabled &&
      (item.mapping.model_type === null || item.mapping.model_type === 'part.part'),
  )
}

export function companiesFor(batch: CaptureSnapshotDto, role: 'manufacturer' | 'supplier') {
  return observed(batch, 'company').filter(
    (item) => item.mapping?.kind === 'company' && item.mapping[role],
  )
}

/** Category mappings for `category` and `template` among the batch's observations. */
export function mappingsFor(batch: CaptureSnapshotDto, category: string, template: string) {
  return observed(batch, 'category_parameter').filter(
    (item) =>
      item.mapping?.kind === 'category_parameter' &&
      item.mapping.category_id === category &&
      item.mapping.template_id === template,
  )
}

export function referenceTo<
  M extends 'category' | 'parameter_template' | 'category_parameter' | 'company',
>(item: Observed<M>) {
  return {
    observation_id: item.id,
    target_context_id: item.target_context_id,
    model: item.model,
    pk: item.pk,
  }
}

export function specOf(batch: CaptureSnapshotDto, partId: string) {
  const part = batch.parts.find((item) => item.id === partId)
  return part?.choice.mode === 'create' ? part.choice.spec : null
}
