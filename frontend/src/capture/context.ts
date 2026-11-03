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
