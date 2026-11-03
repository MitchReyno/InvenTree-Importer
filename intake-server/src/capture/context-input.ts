import type { CaptureSnapshotDto } from '@invimport/contracts'
import { canonical } from '@invimport/contracts/json'

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
