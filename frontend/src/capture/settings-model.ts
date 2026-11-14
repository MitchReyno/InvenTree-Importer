import {
  effectiveSettingsIntent,
  validate,
  type CaptureBatchSettingsChangeDto,
  type CaptureDefaultLocationSettingDto,
  type CaptureReferenceDraftDto,
  type CaptureSettingsIntentDto,
} from '@invimport/contracts'
import type { Snapshot } from './types'

export type SettingsValues = {
  title: string
  batchNote: string | null
  orderNote: string | null
  defaultLocation: CaptureDefaultLocationSettingDto
  intent: CaptureSettingsIntentDto
  drafts: CaptureReferenceDraftDto[]
}

function note(batch: Snapshot, scope: 'batch' | 'order') {
  return batch.setting_notes?.find((record) => record.scope === scope)?.text ?? null
}

export function settingsValues(batch: Snapshot): SettingsValues {
  const draftLocation = batch.settings_intent?.default_location_draft
  const location = batch.defaults.location
  return {
    title: batch.title,
    batchNote: note(batch, 'batch'),
    orderNote: note(batch, 'order'),
    defaultLocation: draftLocation
      ? { mode: 'draft', draft_id: draftLocation }
      : location.mode === 'set'
        ? location.value.model === 'location'
          ? { mode: 'set', value: { ...location.value, model: 'location' } }
          : { mode: 'unknown' }
        : location.mode === 'inherit'
          ? { mode: 'unset' }
          : location,
    intent: effectiveSettingsIntent(batch),
    drafts: (batch.reference_drafts ?? []).map(
      ({ draft_id, kind, value }) => ({ draft_id, kind, value }) as CaptureReferenceDraftDto,
    ),
  }
}

/** Blank text means no current note; a cleared note becomes a Remove tombstone. */
const noteText = (value: string | null) => (value && value.trim() ? value : null)

/** Drafts not referenced by a current selection are omitted, which retires them server-side. */
function activeDrafts(values: SettingsValues) {
  const used = new Set<string>()
  if (values.defaultLocation.mode === 'draft') {
    used.add(values.defaultLocation.draft_id)
  }
  if (values.intent.supplier.selection.mode === 'draft') {
    used.add(values.intent.supplier.selection.draft_id)
  }
  return values.drafts.filter((draft) => used.has(draft.draft_id))
}

/**
 * The complete-state autosave command, or null when local input is not valid yet. It is a deep
 * copy: form state is mutated in place, and a queued request must stay frozen.
 */
export function settingsChange(values: SettingsValues): CaptureBatchSettingsChangeDto | null {
  const change: CaptureBatchSettingsChangeDto = structuredClone({
    kind: 'batch_settings',
    title: values.title,
    default_location: values.defaultLocation,
    intent: values.intent,
    notes: { batch: noteText(values.batchNote), order: noteText(values.orderNote) },
    drafts: activeDrafts(values),
  })
  try {
    // The queue supplies the real revision when it sends; validation only checks the change.
    validate('CaptureEdit', { expected_revision: '1', change })
    return change
  } catch {
    return null
  }
}

export function referenceLabel(batch: Snapshot, observationId: string) {
  return batch.observations.find((item) => item.id === observationId)?.label ?? 'Selected record'
}
