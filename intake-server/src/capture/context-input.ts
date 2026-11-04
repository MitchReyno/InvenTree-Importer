import type { CaptureSnapshotDto } from '@invimport/contracts'
import { createHash } from 'node:crypto'
import { canonical } from '@invimport/contracts/json'

/** Marks the one requested-automation note; acceptance checks it before admitting tag suggestions. */
export const AUTO_TAGS_REQUESTED = 'Shared part tags: Auto requested'

/** Human field selections remain context, never approved inventory effects. */
export function captureContextRecords(snapshot: CaptureSnapshotDto, subjectId: string | null) {
  return (snapshot.context ?? []).filter(
    (record) => record.subject_id === null || record.subject_id === subjectId,
  )
}

function captureContextText(record: NonNullable<CaptureSnapshotDto['context']>[number]) {
  const tags = record.value.tags
  const tagValues =
    tags.mode === 'set' ? tags.value.map((tag) => `${tag.length}:${tag}`).join('\n') : ''
  return [
    'Human capture context, not approved inventory effects:',
    `Version: ${record.version}`,
    `Supplier: ${canonical(record.value.supplier)}`,
    `Purchase date: ${canonical(record.value.purchase_date)}`,
    `Tags mode: ${tags.mode}`,
    'Tag values (UTF-16 length-prefixed, without escaping):',
    tagValues,
  ].join('\n')
}

export function captureContextNotes(snapshot: CaptureSnapshotDto, subjectId: string) {
  return captureContextRecords(snapshot, subjectId).map((record) => ({
    id: record.id,
    subject_id: record.subject_id,
    text: captureContextText(record),
    actor_id: record.actor_id,
    created_at: record.created_at,
    producer: 'human' as const,
  }))
}

/**
 * The requested-automation note has a server-derived identity per batch. Human and media notes
 * have server-assigned random IDs, so ordinary text containing the marker can never match it.
 */
export function automationNoteId(batchId: string) {
  const hex = createHash('sha256').update(`automation-intent:${batchId}`).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

export const AUTOMATION_NOTE_TEXT = [
  'Requested automation, not approved inventory effects:',
  AUTO_TAGS_REQUESTED,
].join('\n')

/**
 * Requested automation is human intent, not evidence or an approved effect. Batches without Auto
 * tags add no note, so their processing inputs keep their exact bytes.
 */
export function automationIntentNotes(snapshot: CaptureSnapshotDto) {
  const intent = snapshot.settings_intent
  if (!intent?.value.shared_tags.auto) {
    return []
  }
  return [
    {
      id: automationNoteId(snapshot.id),
      subject_id: null,
      text: AUTOMATION_NOTE_TEXT,
      actor_id: intent.actor_id,
      created_at: intent.created_at,
      producer: 'human' as const,
    },
  ]
}
