import { eq } from 'drizzle-orm'
import type { Pool, PoolClient } from 'pg'
import { executeDatabaseQuery, queryDatabase } from '#/db/database.ts'
import { targets } from '#/db/schema.ts'
import { fail } from '#/capture/model.ts'
import type { DevConfig } from '#/config.ts'
import { connectionStatus } from './connection.ts'

type Binding = Pick<DevConfig, 'actorId' | 'targetId' | 'targetContextId'>

/** A header binding plus whether its target is the owned test fake. */
type StatusBinding = Binding & Pick<DevConfig, 'targetKind'>

export async function requireHeaderContext(client: Pool | PoolClient, binding: Binding) {
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

/** What connection status is scoped to, including whether the target is the owned test fake. */
export function statusBinding(binding: StatusBinding) {
  return {
    actorId: binding.actorId,
    targetId: binding.targetId,
    targetContextId: binding.targetContextId,
    targetKind: binding.targetKind,
  }
}

export function scopedConnectionStatus(
  pool: Pool,
  binding: StatusBinding,
  origin: string | undefined,
  probe?: () => Promise<Response>,
  version?: () => Promise<Response>,
) {
  const scope = statusBinding(binding)
  const read = connectionStatus(scope, origin, probe, Date.now, version)
  return async () => {
    await requireHeaderContext(pool, scope)
    const result = await read()
    await requireHeaderContext(pool, scope)
    return result
  }
}
