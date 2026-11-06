import { Type, type Static } from '@sinclair/typebox'
import { Id, PositivePk, Revision } from './scalars.ts'
import {
  InventoryPartSpec,
  PartDescription,
  mappedReference,
  type InventoryPartSpecDto,
} from './effects.ts'
import { object } from './capture-primitives.ts'

const text = Type.String({ minLength: 1, maxLength: 256 })
const CompanyRole = Type.Union([Type.Literal('manufacturer'), Type.Literal('supplier')])

/** One record a batch touches; a company or template can be shared by several Parts. */
export const RecordRef = Type.Union([
  object({ kind: Type.Literal('company'), role: CompanyRole, pk: PositivePk }),
  object({ kind: Type.Literal('parameter_template'), pk: PositivePk }),
  object({ kind: Type.Literal('part'), part_subject_id: Id }),
  object({
    kind: Type.Union([Type.Literal('manufacturer_part'), Type.Literal('supplier_part')]),
    part_subject_id: Id,
  }),
  object({ kind: Type.Literal('parameter'), part_subject_id: Id, template_pk: PositivePk }),
])

export const RecordOperation = Type.Union([
  object({ op: Type.Literal('map_to_existing'), reference: mappedReference('company') }),
  object({
    op: Type.Literal('map_template'),
    template: mappedReference('parameter_template'),
    category_mappings: Type.Array(mappedReference('category_parameter'), { maxItems: 32 }),
    exclude_parts: Type.Array(Id, { maxItems: 100, uniqueItems: true }),
  }),
  object({
    op: Type.Literal('set_category'),
    reference: mappedReference('category'),
    parameter_mappings: Type.Array(
      object({ template_pk: PositivePk, category_mapping: mappedReference('category_parameter') }),
      { maxItems: 32 },
    ),
    drop_parameters: Type.Array(PositivePk, { maxItems: 32, uniqueItems: true }),
  }),
  object({ op: Type.Literal('set_name'), value: text }),
  object({ op: Type.Literal('set_tags'), tags: InventoryPartSpec.properties.tags }),
  object({
    op: Type.Literal('set_description'),
    value: Type.Union([PartDescription, Type.Null()]),
  }),
  object({
    op: Type.Literal('set_parameter'),
    template: mappedReference('parameter_template'),
    category_mapping: mappedReference('category_parameter'),
    value: text,
  }),
  object({ op: Type.Literal('remove_parameter') }),
  object({ op: Type.Literal('set_mpn'), company: mappedReference('company'), mpn: text }),
  object({ op: Type.Literal('set_sku'), company: mappedReference('company'), sku: text }),
])

/** A record edit: applied once to every Part that uses the record, at the batch revision. */
export const RecordChange = object({
  kind: Type.Literal('record'),
  target: RecordRef,
  operation: RecordOperation,
})

const choice = <const T extends readonly string[]>(values: T) =>
  Type.Union(values.map((value) => Type.Literal(value)))

const count = Type.Integer({ minimum: 0, maximum: 100000 })

export const RECORD_TYPES = [
  'category',
  'company',
  'part',
  'manufacturer_part',
  'supplier_part',
  'parameter_template',
  'parameter',
  'location',
  'stock_item',
  'tag',
] as const
export const RecordType = choice(RECORD_TYPES)
/** Exists: already in InvenTree. Update: applied to records the batch creates. */
export const RecordState = choice(['new', 'exists', 'update', 'choose', 'unsupported'])
/** Who set a value: the operator, or the processing step whose proposal it still matches. */
export const RecordOrigin = Type.Union([
  object({ kind: Type.Literal('operator') }),
  object({
    kind: Type.Literal('step'),
    step: choice(['examine', 'research', 'images', 'inventory']),
    proposal_id: Id,
  }),
])
export const RecordField = object({
  name: Type.String({ minLength: 1, maxLength: 64 }),
  value: Type.Union([Type.String({ minLength: 1, maxLength: 512 }), Type.Null()]),
  origin: RecordOrigin,
})
export const BatchRecord = object({
  /** Stable within the projection, e.g. `company:supplier:12`. */
  key: Type.String({ minLength: 1, maxLength: 256 }),
  type: RecordType,
  label: text,
  state: RecordState,
  /** The record edit target; null when the record is edited elsewhere or not at all. */
  target: Type.Union([RecordRef, Type.Null()]),
  fields: Type.Array(RecordField, { maxItems: 40 }),
  part_ids: Type.Array(Id, { maxItems: 100 }),
  lot_ids: Type.Array(Id, { maxItems: 100 }),
  decision: Type.Union([
    Type.Null(),
    object({
      code: choice([
        'part_choice_required',
        'location_required',
        'location_conflict',
        'location_draft_parent_invalid',
      ]),
      detail: Type.String({ minLength: 1, maxLength: 512 }),
    }),
  ]),
})
/** Every record a batch touches, read from capture state; it never changes a stored row. */
export const BatchRecords = object({
  batch_id: Id,
  revision: Revision,
  counts: Type.Array(object({ type: RecordType, new: count, existing: count, decide: count }), {
    maxItems: RECORD_TYPES.length,
  }),
  // At most 100 subjects. A Part yields 35 records of its own (itself, its manufacturer and
  // supplier parts, 32 parameters) and up to 67 shared ones (32 templates, 32 tags, a category,
  // two companies): 102 × 100 = 10,200. A lot yields a stock item and at most one location.
  records: Type.Array(BatchRecord, { maxItems: 12000 }),
})

export const recordSchemas = {
  RecordRef,
  RecordOperation,
  RecordChange,
  RecordType,
  RecordState,
  RecordOrigin,
  RecordField,
  BatchRecord,
  BatchRecords,
}

export type RecordRefDto = Static<typeof RecordRef>
export type RecordOperationDto = Static<typeof RecordOperation>
export type RecordChangeDto = Static<typeof RecordChange>
export type RecordTypeDto = Static<typeof RecordType>
export type RecordStateDto = Static<typeof RecordState>
export type RecordOriginDto = Static<typeof RecordOrigin>
export type RecordFieldDto = Static<typeof RecordField>
export type BatchRecordDto = Static<typeof BatchRecord>
export type BatchRecordsDto = Static<typeof BatchRecords>

/** A refusal; `partId` names the Part that caused it, when there is one. */
export class RecordEditError extends Error {
  readonly code: string
  readonly partId: string | undefined

  constructor(code: string, partId?: string) {
    super(code)
    this.code = code
    this.partId = partId
  }
}

type Reference = { observation_id: string; target_context_id: string; model: string; pk: string }
type Observation = {
  id: string
  model: string
  pk: string
  target_context_id: string
  mapping?: { kind: string; [key: string]: unknown }
}
/** The parts of a capture snapshot a record edit reads. */
export interface RecordSnapshot {
  parts: readonly { id: string; choice: { mode: string; spec?: InventoryPartSpecDto } }[]
  lots: readonly { id: string; part_subject_id: string | null; retired?: true }[]
  observations: readonly Observation[]
}

export interface RecordScope {
  partIds: string[]
  /** Active lots of those Parts. */
  lotIds: string[]
}

function specOf(snapshot: RecordSnapshot, partId: string) {
  const part = snapshot.parts.find((item) => item.id === partId)
  if (!part) {
    throw new RecordEditError('record_not_found')
  }
  if (part.choice.mode !== 'create' || !part.choice.spec) {
    throw new RecordEditError('record_part_has_no_spec', partId)
  }
  return part.choice.spec
}

function specs(snapshot: RecordSnapshot) {
  return snapshot.parts.flatMap((part) =>
    part.choice.mode === 'create' && part.choice.spec
      ? [{ id: part.id, spec: part.choice.spec }]
      : [],
  )
}

function lotsOf(snapshot: RecordSnapshot, partIds: readonly string[]) {
  return snapshot.lots
    .filter((lot) => !lot.retired && lot.part_subject_id && partIds.includes(lot.part_subject_id))
    .map((lot) => lot.id)
}

/** The Parts a record belongs to, before any operation narrows it. */
export function recordScope(snapshot: RecordSnapshot, target: RecordRefDto): RecordScope {
  let partIds: string[]
  if (target.kind === 'company') {
    partIds = specs(snapshot)
      .filter(({ spec }) => spec[target.role]?.company.pk === target.pk)
      .map(({ id }) => id)
  } else if (target.kind === 'parameter_template') {
    partIds = specs(snapshot)
      .filter(({ spec }) => spec.parameters.some((item) => item.template.pk === target.pk))
      .map(({ id }) => id)
  } else {
    specOf(snapshot, target.part_subject_id)
    partIds = [target.part_subject_id]
  }
  return { partIds, lotIds: lotsOf(snapshot, partIds) }
}

function observed(snapshot: RecordSnapshot, reference: Reference) {
  const found = snapshot.observations.find((item) => item.id === reference.observation_id)
  if (
    !found ||
    found.model !== reference.model ||
    found.pk !== reference.pk ||
    found.target_context_id !== reference.target_context_id ||
    found.mapping?.kind !== reference.model
  ) {
    throw new RecordEditError('mapping_observation_invalid')
  }
  return found.mapping
}

function requireRole(
  snapshot: RecordSnapshot,
  company: Reference,
  role: 'manufacturer' | 'supplier',
) {
  if (observed(snapshot, company)[role] !== true) {
    throw new RecordEditError('company_role_incompatible')
  }
}

/** The observed category mapping for `category` and `template` among `mappings`, if any. */
function mappingFor<R extends Reference>(
  snapshot: RecordSnapshot,
  mappings: readonly R[],
  category: string,
  template: string,
): R | undefined {
  return mappings.find((mapping) => {
    const value = observed(snapshot, mapping)
    return value.category_id === category && value.template_id === template
  })
}

function requireMapping(
  snapshot: RecordSnapshot,
  mapping: Reference,
  category: string,
  template: string,
  partId: string,
) {
  if (!mappingFor(snapshot, [mapping], category, template)) {
    throw new RecordEditError('parameter_category_incompatible', partId)
  }
}

function withDescription(spec: InventoryPartSpecDto, value: string | null): InventoryPartSpecDto {
  // An unset description is absent, so existing specs and their digests stay byte-identical.
  const { description: _previous, ...rest } = spec
  return value === null ? rest : { ...rest, description: value }
}

export interface RecordEditResult extends RecordScope {
  /** The rewritten spec of every Part the edit changes, in snapshot order. */
  specs: Map<string, InventoryPartSpecDto>
}

/** Applies a record edit to the snapshot's Part specs; the server re-validates each result. */
export function applyRecordChange(
  snapshot: RecordSnapshot,
  change: RecordChangeDto,
): RecordEditResult {
  const { target, operation } = change
  const scope = recordScope(snapshot, target)
  if (!scope.partIds.length) {
    throw new RecordEditError('record_not_found')
  }

  const invalid = () => new RecordEditError('record_operation_invalid')

  const next = new Map<string, InventoryPartSpecDto>()

  for (const partId of scope.partIds) {
    const spec = specOf(snapshot, partId)
    switch (operation.op) {
      case 'map_to_existing': {
        if (target.kind !== 'company') {
          throw invalid()
        }
        requireRole(snapshot, operation.reference, target.role)
        next.set(partId, {
          ...spec,
          [target.role]: { ...spec[target.role]!, company: operation.reference },
        })
        break
      }
      case 'map_template': {
        if (target.kind !== 'parameter_template') {
          throw invalid()
        }
        if (operation.exclude_parts.includes(partId)) {
          break
        }
        const template = operation.template
        if (
          template.pk !== target.pk &&
          spec.parameters.some((item) => item.template.pk === template.pk)
        ) {
          throw new RecordEditError('duplicate_parameter_mapping', partId)
        }
        const mapping = mappingFor(
          snapshot,
          operation.category_mappings,
          spec.category.pk,
          template.pk,
        )
        if (!mapping) {
          throw new RecordEditError('parameter_category_incompatible', partId)
        }
        next.set(partId, {
          ...spec,
          parameters: spec.parameters.map((item) =>
            item.template.pk === target.pk
              ? { ...item, template, category_mapping: mapping }
              : item,
          ),
        })
        break
      }
      case 'set_category': {
        if (target.kind !== 'part') {
          throw invalid()
        }
        observed(snapshot, operation.reference)
        const parameters = []
        for (const item of spec.parameters) {
          if (operation.drop_parameters.includes(item.template.pk)) {
            continue
          }
          const mapped = operation.parameter_mappings.find(
            (entry) => entry.template_pk === item.template.pk,
          )
          if (!mapped) {
            throw new RecordEditError('parameter_mapping_required', partId)
          }
          requireMapping(
            snapshot,
            mapped.category_mapping,
            operation.reference.pk,
            item.template.pk,
            partId,
          )
          parameters.push({ ...item, category_mapping: mapped.category_mapping })
        }
        next.set(partId, { ...spec, category: operation.reference, parameters })
        break
      }
      case 'set_name':
      case 'set_tags':
      case 'set_description': {
        if (target.kind !== 'part') {
          throw invalid()
        }
        next.set(
          partId,
          operation.op === 'set_name'
            ? { ...spec, name: operation.value }
            : operation.op === 'set_tags'
              ? { ...spec, tags: operation.tags }
              : withDescription(spec, operation.value),
        )
        break
      }
      case 'set_parameter': {
        // A parameter keeps its template; mapping a template is `map_template`.
        if (target.kind !== 'parameter' || operation.template.pk !== target.template_pk) {
          throw invalid()
        }
        requireMapping(
          snapshot,
          operation.category_mapping,
          spec.category.pk,
          operation.template.pk,
          partId,
        )
        const parameter = {
          template: operation.template,
          category_mapping: operation.category_mapping,
          value: operation.value,
        }
        const exists = spec.parameters.some((item) => item.template.pk === target.template_pk)
        next.set(partId, {
          ...spec,
          parameters: exists
            ? spec.parameters.map((item) =>
                item.template.pk === target.template_pk ? parameter : item,
              )
            : [...spec.parameters, parameter],
        })
        break
      }
      case 'remove_parameter': {
        if (target.kind !== 'parameter') {
          throw invalid()
        }
        if (!spec.parameters.some((item) => item.template.pk === target.template_pk)) {
          throw new RecordEditError('record_not_found')
        }
        next.set(partId, {
          ...spec,
          parameters: spec.parameters.filter((item) => item.template.pk !== target.template_pk),
        })
        break
      }
      case 'set_mpn': {
        if (target.kind !== 'manufacturer_part') {
          throw invalid()
        }
        requireRole(snapshot, operation.company, 'manufacturer')
        next.set(partId, {
          ...spec,
          manufacturer: { company: operation.company, mpn: operation.mpn },
        })
        break
      }
      case 'set_sku': {
        if (target.kind !== 'supplier_part') {
          throw invalid()
        }
        requireRole(snapshot, operation.company, 'supplier')
        next.set(partId, { ...spec, supplier: { company: operation.company, sku: operation.sku } })
        break
      }
    }
  }

  const partIds = [...next.keys()]
  if (!partIds.length) {
    // Every Part was excluded, so nothing would change.
    throw new RecordEditError('record_scope_empty')
  }
  return { specs: next, partIds, lotIds: lotsOf(snapshot, partIds) }
}
