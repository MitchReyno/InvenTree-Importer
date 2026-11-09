import { executeDatabaseQuery, queryDatabase, transaction } from '../db/database.ts'
import { manualReviews } from './schema.ts'
import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import type { ManualScopeDto } from '@invimport/contracts'
import { idempotent, appendEvent } from '../db/authority.ts'
import { fail } from '../capture/model.ts'
import type { ManualConfig } from './authority.ts'
import { commandScope, normalizedScope, checkedSelection } from './selection.ts'

export async function markReviewed(
  pool: Pool,
  config: ManualConfig,
  batchId: string,
  key: string,
  input: ManualScopeDto,
) {
  return transaction(pool, (client) =>
    idempotent(
      client,
      commandScope(config, 'manual_review', batchId, key),
      normalizedScope(input),
      async () => {
        const selected = await checkedSelection(client, config, batchId, input)
        if (selected.issues.length) {
          fail(selected.issues[0].code, 409)
        }
        for (const subject of selected.material.subjects) {
          await executeDatabaseQuery(
            queryDatabase(client).insert(manualReviews).values({
              id: randomUUID(),
              batchId,
              subjectId: subject.subjectId,
              actorId: config.actorId,
              dependencyBytes: subject.bytes,
              dependencyDigest: subject.digest,
            }),
          )
        }
        const sequence = await appendEvent(client, selected.capture.streamId, 'manual_reviewed', {
          batch_id: batchId,
          selected_lot_ids: selected.material.selected,
        })
        return {
          reviewed_subject_ids: selected.material.subjects.map((value) => value.subjectId),
          cursor: { stream_id: selected.capture.streamId, sequence },
        }
      },
    ),
  )
}
