import type { PoolClient } from 'pg'
import { eq } from 'drizzle-orm'
import { executeDatabaseQuery, queryDatabase } from '#/db/database.ts'
import { processingLanes } from './schema.ts'
import type { ProcessingConfig } from './attempts.ts'

export function commandScope(
  config: ProcessingConfig,
  action: string,
  resource: string,
  key: string,
) {
  return {
    actorId: config.actorId,
    action,
    resourceKey: `${config.targetId}:${config.targetContextId}:${resource}`,
    key,
  }
}

export async function lockLane(client: PoolClient, actorId: string) {
  await executeDatabaseQuery(
    queryDatabase(client).insert(processingLanes).values({ actorId }).onConflictDoNothing(),
  )
  const rows = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ attempt_id: processingLanes.attemptId })
      .from(processingLanes)
      .where(eq(processingLanes.actorId, actorId))
      .for('update'),
  )
  return rows[0]
}
