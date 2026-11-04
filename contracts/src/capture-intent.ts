import { Type, type Static, type TSchema } from '@sinclair/typebox'
import { Id, PositivePk, Revision } from './scalars.ts'
import { mappedReference } from './effects.ts'
import { calendarDate, captureTags, label, object } from './capture-primitives.ts'
import type { CaptureContextDto, CaptureLotContextDto, CaptureSnapshotDto } from './capture.ts'

/**
 * Batch settings intent. These records are retained human requests, never approved effects:
 * Auto asks for an evidence-derived proposal, None records explicit absence and Manual keeps
 * the exact human value. Drafts describe records that do not exist in inventory yet.
 */
const autoValue = <T extends TSchema>(value: T) =>
  Type.Union([
    object({ mode: Type.Literal('auto') }),
    object({ mode: Type.Literal('none') }),
    object({ mode: Type.Literal('manual'), value }),
  ])

const ORDER_REFERENCE_MAX_CHARACTERS = 128
const SETTING_NOTE_MAX_CHARACTERS = 8192
const DRAFT_NAME_MAX_CHARACTERS = 100
const DRAFT_DESCRIPTION_MAX_CHARACTERS = 250
export const MAX_REFERENCE_DRAFTS = 16

const orderReference = Type.String({
  minLength: 1,
  maxLength: ORDER_REFERENCE_MAX_CHARACTERS,
  pattern: '[^\\s]',
})
const settingNote = Type.String({ minLength: 1, maxLength: SETTING_NOTE_MAX_CHARACTERS })
const draftName = Type.String({
  minLength: 1,
  maxLength: DRAFT_NAME_MAX_CHARACTERS,
  pattern: '[^\\s]',
})
const draftDescription = Type.String({ maxLength: DRAFT_DESCRIPTION_MAX_CHARACTERS })
const provenance = { version: Revision, actor_id: Id, created_at: Type.String() }

export const CaptureLocationReference = object({
  observation_id: Id,
  target_context_id: Id,
  model: Type.Literal('location'),
  pk: PositivePk,
})

export const CaptureSupplierSelection = Type.Union([
  object({ mode: Type.Literal('unset') }),
  object({ mode: Type.Literal('existing'), reference: mappedReference('company') }),
  object({ mode: Type.Literal('draft'), draft_id: Id }),
])

export const CaptureSettingsIntent = object({
  /** Absence is separate from the selection so unchecking No supplier restores it. */
  supplier: object({ absent: Type.Boolean(), selection: CaptureSupplierSelection }),
  order: object({ reference: autoValue(orderReference), purchase_date: autoValue(calendarDate) }),
  shared_tags: object({ manual: captureTags, auto: Type.Boolean() }),
})

export const CaptureLogoReference = object({ evidence_id: Id, version_id: Id })
export const CaptureLocationDraft = object({
  name: draftName,
  description: draftDescription,
  parent: Type.Union([Type.Null(), CaptureLocationReference]),
})
export const CaptureCompanyDraft = object({
  name: draftName,
  description: draftDescription,
  also_manufacturer: Type.Boolean(),
  logo: Type.Union([Type.Null(), CaptureLogoReference]),
})
const locationDraft = { draft_id: Id, kind: Type.Literal('location'), value: CaptureLocationDraft }
const companyDraft = { draft_id: Id, kind: Type.Literal('company'), value: CaptureCompanyDraft }
export const CaptureReferenceDraft = Type.Union([object(locationDraft), object(companyDraft)])
export const CaptureReferenceDraftRecord = Type.Union([
  object({ ...locationDraft, ...provenance }),
  object({ ...companyDraft, ...provenance }),
])

export const CaptureSettingNoteScope = Type.Union([Type.Literal('batch'), Type.Literal('order')])
export const CaptureSettingNoteRecord = object({
  scope: CaptureSettingNoteScope,
  /** Null is a Remove tombstone; earlier text stays in retained history. */
  text: Type.Union([settingNote, Type.Null()]),
  ...provenance,
})
export const CaptureSettingsIntentRecord = object({
  value: CaptureSettingsIntent,
  /** A pending new-location draft chosen as Default location; the existing selection is unset. */
  default_location_draft: Type.Union([Id, Type.Null()]),
  ...provenance,
})

export const CaptureDefaultLocationSetting = Type.Union([
  object({ mode: Type.Literal('unset') }),
  object({ mode: Type.Literal('unknown') }),
  object({ mode: Type.Literal('clear') }),
  object({ mode: Type.Literal('set'), value: CaptureLocationReference }),
  object({ mode: Type.Literal('draft'), draft_id: Id }),
])

/**
 * Complete-state settings save used by autosave. The server writes only changed facts under one
 * revision. Quantity mode is deliberately absent; per-lot exact counts stay in Review.
 */
export const CaptureBatchSettingsChange = object({
  kind: Type.Literal('batch_settings'),
  title: label,
  default_location: CaptureDefaultLocationSetting,
  intent: CaptureSettingsIntent,
  notes: object({
    batch: Type.Union([settingNote, Type.Null()]),
    order: Type.Union([settingNote, Type.Null()]),
  }),
  /** The complete active draft set; a retained draft omitted here is retired. */
  drafts: Type.Array(CaptureReferenceDraft, { maxItems: MAX_REFERENCE_DRAFTS }),
})

export const captureIntentSchemas = {
  CaptureSettingsIntent,
  CaptureSettingsIntentRecord,
  CaptureSettingNoteRecord,
  CaptureReferenceDraft,
  CaptureReferenceDraftRecord,
  CaptureDefaultLocationSetting,
}

export type CaptureSettingsIntentDto = Static<typeof CaptureSettingsIntent>
export type CaptureSupplierSelectionDto = Static<typeof CaptureSupplierSelection>
export type CaptureReferenceDraftDto = Static<typeof CaptureReferenceDraft>
export type CaptureReferenceDraftRecordDto = Static<typeof CaptureReferenceDraftRecord>
export type CaptureSettingNoteRecordDto = Static<typeof CaptureSettingNoteRecord>
export type CaptureSettingNoteScopeDto = Static<typeof CaptureSettingNoteScope>
export type CaptureDefaultLocationSettingDto = Static<typeof CaptureDefaultLocationSetting>
export type CaptureBatchSettingsChangeDto = Static<typeof CaptureBatchSettingsChange>

/**
 * Read-time mapping for batches saved before intent existed. Legacy unset and unknown both mean
 * no human value: they map to Auto, whose unresolved state is unknown for review.
 */
export function captureIntentFromLegacy(
  context: CaptureContextDto | CaptureLotContextDto | undefined,
): CaptureSettingsIntentDto {
  const supplier = context?.supplier
  const purchaseDate = context?.purchase_date
  const tags = context?.tags

  let supplierIntent: CaptureSettingsIntentDto['supplier'] = {
    absent: false,
    selection: { mode: 'unset' },
  }
  if (supplier?.mode === 'set') {
    supplierIntent = { absent: false, selection: { mode: 'existing', reference: supplier.value } }
  } else if (supplier?.mode === 'clear') {
    supplierIntent = { absent: true, selection: { mode: 'unset' } }
  }

  let purchaseDateIntent: CaptureSettingsIntentDto['order']['purchase_date'] = { mode: 'auto' }
  if (purchaseDate?.mode === 'set') {
    purchaseDateIntent = { mode: 'manual', value: purchaseDate.value }
  } else if (purchaseDate?.mode === 'clear') {
    purchaseDateIntent = { mode: 'none' }
  }

  return {
    supplier: supplierIntent,
    order: { reference: { mode: 'auto' }, purchase_date: purchaseDateIntent },
    shared_tags: { manual: tags?.mode === 'set' ? [...tags.value] : [], auto: false },
  }
}

/** Batch-level legacy context derived from intent, so existing consumers keep their inputs. */
export function legacyContextFromIntent(intent: CaptureSettingsIntentDto): CaptureContextDto {
  let supplier: CaptureContextDto['supplier'] = { mode: 'unset' }
  if (intent.supplier.absent) {
    supplier = { mode: 'clear' }
  } else if (intent.supplier.selection.mode === 'existing') {
    supplier = { mode: 'set', value: intent.supplier.selection.reference }
  } else if (intent.supplier.selection.mode === 'draft') {
    supplier = { mode: 'unknown' }
  }

  const date = intent.order.purchase_date
  let purchaseDate: CaptureContextDto['purchase_date'] = { mode: 'unset' }
  if (date.mode === 'manual') {
    purchaseDate = { mode: 'set', value: date.value }
  } else if (date.mode === 'none') {
    purchaseDate = { mode: 'clear' }
  }

  const manualTags = intent.shared_tags.manual
  const tags: CaptureContextDto['tags'] = manualTags.length
    ? { mode: 'set', value: [...manualTags] }
    : { mode: 'unset' }

  return { supplier, purchase_date: purchaseDate, tags }
}

const sameValue = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)

/**
 * Next batch-level legacy context after an intent save. A field keeps its retained legacy mode
 * (including `unknown` and `clear`) unless that field's intent changed, so an unrelated save
 * never collapses human distinctions the intent mapping cannot represent. Returns undefined
 * when nothing changes and no legacy row exists yet.
 */
export function nextLegacyContext(
  current: CaptureContextDto | CaptureLotContextDto | undefined,
  previous: CaptureSettingsIntentDto,
  next: CaptureSettingsIntentDto,
): CaptureContextDto | undefined {
  const derived = legacyContextFromIntent(next)
  const retained: CaptureContextDto = {
    supplier:
      current?.supplier.mode === 'inherit'
        ? { mode: 'unset' }
        : (current?.supplier ?? { mode: 'unset' }),
    purchase_date:
      current?.purchase_date.mode === 'inherit'
        ? { mode: 'unset' }
        : (current?.purchase_date ?? { mode: 'unset' }),
    tags:
      current?.tags.mode === 'inherit' ? { mode: 'unset' } : (current?.tags ?? { mode: 'unset' }),
  }
  const result: CaptureContextDto = {
    supplier: sameValue(previous.supplier, next.supplier) ? retained.supplier : derived.supplier,
    purchase_date: sameValue(previous.order.purchase_date, next.order.purchase_date)
      ? retained.purchase_date
      : derived.purchase_date,
    tags: sameValue(previous.shared_tags.manual, next.shared_tags.manual)
      ? retained.tags
      : derived.tags,
  }
  if (current === undefined && sameValue(result, retained)) {
    return undefined
  }
  return result
}

/** Retained intent when present, otherwise the deterministic legacy mapping. */
export function effectiveSettingsIntent(snapshot: CaptureSnapshotDto): CaptureSettingsIntentDto {
  if (snapshot.settings_intent) {
    return snapshot.settings_intent.value
  }
  const batchContext = snapshot.context?.find((record) => record.subject_id === null)
  return captureIntentFromLegacy(batchContext?.value)
}
