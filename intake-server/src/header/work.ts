import type { Pool } from 'pg'
import { validate, type HeaderWorkDto } from '@invimport/contracts'
import { transaction } from '../db/database.ts'
import type { ProcessingConfig } from '../processing/attempts.ts'
import type { ManualConfig } from '../review/authority.ts'
import { processingActivity } from '../processing/read.ts'
import { prepareMediaTransaction } from '../media/transaction.ts'
import { requireHeaderContext } from './binding.ts'
import { activeHeaderSessions } from './active-sessions.ts'
import { processingHeaderWork } from './processing.ts'
import { importHeaderWork } from './imports.ts'

export type HeaderReadConfig = ProcessingConfig & ManualConfig

export async function headerWork(
  pool: Pool,
  config: HeaderReadConfig,
  batchId?: string,
): Promise<HeaderWorkDto> {
  return transaction(pool, async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
    await requireHeaderContext(client, config)
    await prepareMediaTransaction(client)
    const activity = await processingActivity(client, config)
    const sessions = await activeHeaderSessions(client, config, batchId)
    const processing = await processingHeaderWork(client, config, activity, batchId)
    const imports = await importHeaderWork(client, config, batchId)
    const work = [...processing, ...imports.work]
    work.sort(
      (left, right) =>
        Number(right.batch_id === batchId) - Number(left.batch_id === batchId) ||
        left.batch_id.localeCompare(right.batch_id) ||
        left.kind.localeCompare(right.kind) ||
        left.id.localeCompare(right.id),
    )
    const result: HeaderWorkDto = {
      actor_id: config.actorId,
      target_id: config.targetId,
      target_context_id: config.targetContextId,
      observed_at: new Date().toISOString(),
      work: work.slice(0, 100),
      active_sessions: sessions.sessions,
      work_truncated: activity.truncated || imports.truncated || work.length > 100,
      sessions_truncated: sessions.truncated,
      lane_occupied: activity.lane_occupied,
    }
    validate('HeaderWork', result)
    return result
  })
}
