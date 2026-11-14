import type { PoolClient } from 'pg'
import { eq, sql } from 'drizzle-orm'
import { executeDatabaseQuery, queryDatabase } from '#/db/database.ts'
import { executorCancels } from './schema.ts'

export async function cancellationVersion(client: PoolClient, runId: string): Promise<string> {
  const rows = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ version: sql<string>`coalesce(max(${executorCancels.id}),0)::text` })
      .from(executorCancels)
      .where(eq(executorCancels.runId, runId)),
  )
  return rows[0].version
}
