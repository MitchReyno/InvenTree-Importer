import type { Pool } from 'pg'
import type { DBOSClient } from '@dbos-inc/dbos-sdk'
import { deliverCommand } from '../workers/delivery.ts'
import { loadRun } from './authority.ts'

/** One bounded outbox delivery through the qualified DBOS PUBLIC client. A successful
 * scheduler ACK grants neither host ownership nor permission to repeat any request.
 * The scheduler's handler uses startApply; the child revalidates original authority.
 */
export async function deliverStockCommand(pool: Pool, scheduler: DBOSClient, commandId: string) {
  const row = (await pool.query('SELECT id FROM executor_run WHERE command_id=$1', [commandId]))
    .rows[0]
  if (!row) {
    throw new Error('stock_command_authority_missing')
  }
  const authority = await loadRun(pool, row.id)
  if (authority.commandId !== commandId) {
    throw new Error('stock_command_binding_mismatch')
  }
  return deliverCommand(pool, scheduler, commandId)
}
