import { randomUUID } from 'node:crypto'
import type { CaptureSnapshotDto } from '@invimport/contracts'

/** Synthetic retained manual evidence. No inventory/provider connection is constructed. */
export function manualInputFixture(): CaptureSnapshotDto {
  const subjectId = randomUUID()
  return {
    id: randomUUID(),
    source_id: randomUUID(),
    title: 'Two packets',
    revision: '12',
    archived: false,
    updated_at: '2026-11-01T00:00:00Z',
    actor_id: randomUUID(),
    target_context_id: randomUUID(),
    defaults: { quantity: { mode: 'unknown' }, location: { mode: 'clear' } },
    lots: [
      {
        id: subjectId,
        label: 'Packet A',
        revision: '3',
        contribution_key: randomUUID(),
        part_subject_id: null,
        quantity: { mode: 'set', value: '17.000001' },
        location: { mode: 'inherit' },
      },
    ],
    parts: [],
    observations: [],
    notes: [
      {
        id: randomUUID(),
        subject_id: subjectId,
        text: 'Human counted 17.000001 units.',
        actor_id: randomUUID(),
        created_at: '2026-11-01T00:00:00Z',
        producer: 'human',
      },
    ],
    cursor: { stream_id: randomUUID(), sequence: '9' },
  }
}
