import type { PoolClient } from 'pg'
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
  await client.query('INSERT INTO processing_lane(actor_id) VALUES($1) ON CONFLICT DO NOTHING', [
    actorId,
  ])
  return (
    await client.query('SELECT attempt_id FROM processing_lane WHERE actor_id=$1 FOR UPDATE', [
      actorId,
    ])
  ).rows[0]
}
