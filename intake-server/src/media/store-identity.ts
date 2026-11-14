import type { Pool, PoolClient } from 'pg'
import { sql } from 'drizzle-orm'
import { id } from '#/execution/plan.ts'
import { executeDatabaseQuery, queryDatabase } from '#/db/database.ts'

/** Read-only at runtime. Only the migration creates this durable database authority. */
export async function readMediaStoreIdentity(connection: Pool | PoolClient): Promise<string> {
  // Drizzle does not allow pgSchema('public'); startup must not rely on search_path.
  const result = await executeDatabaseQuery(
    queryDatabase(connection).execute<{ store_id: unknown }>(
      sql`SELECT store_id FROM public.media_store_identity WHERE singleton=true`,
    ),
  )
  const rows = result.rows
  if (rows.length !== 1) {
    throw new Error('media_store_identity_missing')
  }
  const storeId = rows[0].store_id
  id(storeId)
  return storeId
}
