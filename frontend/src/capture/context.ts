import type { CaptureContextDto, CaptureLotContextDto } from '@invimport/contracts'
import type { Snapshot } from './types'

export function captureContext(batch: Snapshot, subjectId: string | null): CaptureLotContextDto {
  return (
    batch.context?.find((record) => record.subject_id === subjectId)?.value ?? {
      supplier: { mode: subjectId ? 'inherit' : 'unset' },
      purchase_date: { mode: subjectId ? 'inherit' : 'unset' },
      tags: { mode: subjectId ? 'inherit' : 'unset' },
    }
  )
}

export function batchContext(batch: Snapshot): CaptureContextDto {
  const context = captureContext(batch, null)
  return {
    supplier: context.supplier.mode === 'inherit' ? { mode: 'unset' } : context.supplier,
    purchase_date:
      context.purchase_date.mode === 'inherit' ? { mode: 'unset' } : context.purchase_date,
    tags: context.tags.mode === 'inherit' ? { mode: 'unset' } : context.tags,
  }
}

export function contextDescription(
  batch: Snapshot,
  subjectId: string | null,
  field: keyof CaptureLotContextDto,
): string {
  const choice = captureContext(batch, subjectId)[field]
  const draft = field === 'supplier' && subjectId === null ? supplierDraftName(batch) : null
  if (draft) {
    return `New supplier ${draft} · created only after approval`
  }
  if (choice.mode === 'inherit') {
    return `Inherited · ${contextDescription(batch, null, field)}`
  }
  if (choice.mode !== 'set') {
    return { unset: 'Not selected', unknown: 'Explicitly unknown', clear: 'Explicitly cleared' }[
      choice.mode
    ]
  }
  const value = choice.value
  if (typeof value === 'string') {
    return value
  }
  if (Array.isArray(value)) {
    return value.join(' · ') || 'No tags'
  }
  const observation = batch.observations.find((item) => item.id === value.observation_id)
  return `${observation?.label ?? 'Retained supplier'} (#${value.pk})`
}

export function normalizeContextTags(context: CaptureLotContextDto): CaptureLotContextDto {
  if (context.tags.mode !== 'set') {
    return context
  }
  return {
    ...context,
    tags: { mode: 'set', value: context.tags.value.map((tag) => tag.trim()).filter(Boolean) },
  }
}

/** The batch supplier's pending new-supplier draft, kept apart from the legacy context value. */
export function supplierDraftName(batch: Snapshot) {
  const supplier = batch.settings_intent?.value.supplier
  if (!supplier || supplier.absent || supplier.selection.mode !== 'draft') {
    return null
  }
  const draftId = supplier.selection.draft_id
  const draft = batch.reference_drafts?.find(
    (record) => record.draft_id === draftId && record.kind === 'company',
  )
  return draft?.value.name ?? null
}

/** The pending Default-location draft, which applies only while the batch default is unset. */
export function locationDraftName(batch: Snapshot) {
  const draftId = batch.settings_intent?.default_location_draft
  const draft = batch.reference_drafts?.find(
    (record) => record.draft_id === draftId && record.kind === 'location',
  )
  return draft && batch.defaults.location.mode === 'unset' ? draft.value.name : null
}
