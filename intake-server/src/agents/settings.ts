import type { Pool, PoolClient } from 'pg'
import { and, eq } from 'drizzle-orm'
import { validate, type AgentSettingsDto, type AgentSettingsUpdateDto } from '@invimport/contracts'
import type { CaptureBinding } from '../capture/repository.ts'
import { executeDatabaseQuery, queryDatabase, transaction } from '../db/database.ts'
import { fail } from '../processing/model.ts'
import { agentSettings } from './schema.ts'

function settingsScope(binding: CaptureBinding) {
  return and(
    eq(agentSettings.actorId, binding.actorId),
    eq(agentSettings.targetId, binding.targetId),
    eq(agentSettings.targetContextId, binding.targetContextId),
  )
}

export async function readAgentSettings(
  client: Pool | PoolClient,
  binding: CaptureBinding,
  lock = false,
): Promise<AgentSettingsDto> {
  const query = queryDatabase(client).select().from(agentSettings).where(settingsScope(binding))
  const rows = await executeDatabaseQuery(lock ? query.for('share') : query)
  const row = rows[0]
  if (!row) {
    return { revision: '0', selection: null }
  }
  return {
    revision: row.revision.toString(),
    selection: { provider: row.provider, authentication: row.authentication, model: row.model },
  }
}

export async function saveAgentSettings(
  pool: Pool,
  binding: CaptureBinding,
  input: AgentSettingsUpdateDto,
) {
  validate('AgentSettingsUpdate', input)
  return transaction(pool, async (client) => {
    const db = queryDatabase(client)
    if (input.expected_revision === '0') {
      const inserted = await executeDatabaseQuery(
        db
          .insert(agentSettings)
          .values({
            actorId: binding.actorId,
            targetId: binding.targetId,
            targetContextId: binding.targetContextId,
            ...input.selection,
            revision: 1n,
          })
          .onConflictDoNothing()
          .returning(),
      )
      if (!inserted.length) {
        fail('revision_conflict', 412)
      }
    } else {
      const updated = await executeDatabaseQuery(
        db
          .update(agentSettings)
          .set({ ...input.selection, revision: BigInt(input.expected_revision) + 1n })
          .where(
            and(
              settingsScope(binding),
              eq(agentSettings.revision, BigInt(input.expected_revision)),
            ),
          )
          .returning(),
      )
      if (!updated.length) {
        fail('revision_conflict', 412)
      }
    }
    return readAgentSettings(client, binding)
  })
}
