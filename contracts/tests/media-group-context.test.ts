import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { validate } from '../src/index.ts'
import { assertMediaInputManifest } from '../src/media.ts'

test('bulk moves reject duplicate or empty selection and group context integers stay exact under interpreted validation', () => {
  const id = randomUUID()
  for (const evidence_ids of [[], [id, id]]) {
    assert.throws(() =>
      validate('MediaEdit', {
        expected_revision: '1',
        change: { kind: 'move_many', evidence_ids, group_id: null },
      }),
    )
  }
  const manifest = {
    version: 'media-inputs/3',
    batchId: randomUUID(),
    subjectIds: [],
    attachments: [],
    evidence: [],
    versions: [],
    context: {
      groups: [],
      evidenceNotes: [
        {
          evidenceId: id,
          note: {
            id: randomUUID(),
            version: '9223372036854775807',
            actor_id: randomUUID(),
            created_at: '2026-11-03T00:00:00.000Z',
            text: 'Retained human observation',
          },
        },
      ],
    },
  }
  assertMediaInputManifest(manifest)
  manifest.context.evidenceNotes[0].note.version = '9223372036854775808'
  assert.throws(() => assertMediaInputManifest(manifest))
})
