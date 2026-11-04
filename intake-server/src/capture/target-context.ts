import { eq } from 'drizzle-orm'
import type { Pool, PoolClient } from 'pg'
import { executeDatabaseQuery, queryDatabase } from '../db/database.ts'
import { targets } from '../db/schema.ts'
import { fail, type CaptureBinding } from './repository.ts'

/** Fences target reads: a rotated target context makes late results unusable for this scope. */
export async function requireCurrentTargetContext(
  client: Pool | PoolClient,
  binding: CaptureBinding,
) {
  const rows = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ context: targets.currentContextId })
      .from(targets)
      .where(eq(targets.id, binding.targetId)),
  )
  if (rows[0]?.context !== binding.targetContextId) {
    fail('target_context_changed', 409)
  }
}
