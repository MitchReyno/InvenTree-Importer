import type { CaptureSnapshotDto } from '@invimport/contracts'
import { canonical } from '@invimport/contracts/json'

/** Human field selections remain context, never approved inventory effects. */
export function captureContextRecords(snapshot: CaptureSnapshotDto, subjectId: string | null) {
  return (snapshot.context ?? []).filter(
    (record) => record.subject_id === null || record.subject_id === subjectId,
  )
}

export function captureContextNotes(snapshot: CaptureSnapshotDto, subjectId: string) {
  return captureContextRecords(snapshot, subjectId).map((record) => ({
    id: record.id,
    subject_id: record.subject_id,
    text: `Human capture context, not approved inventory effects: ${canonical({ version: record.version, value: record.value })}`,
    actor_id: record.actor_id,
    created_at: record.created_at,
    producer: 'human' as const,
  }))
}
