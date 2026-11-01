import type { DBOSClient } from '@dbos-inc/dbos-sdk'
import type { Pool } from 'pg'
import { eq } from 'drizzle-orm'
import { canonical, strictJson } from '@invimport/contracts/json'
import { drizzle } from 'drizzle-orm/node-postgres'
import { commands } from '../db/schema.ts'
import { verifyBytes } from '../db/authority.ts'

/** One bounded delivery, no daemon/worker/claim ownership. The outbox owns redelivery, never physical writes. */
export async function deliverCommand(pool: Pool, scheduler: DBOSClient, commandId: string): Promise<'acked' | 'conflict'> {
  const [command] = await drizzle(pool).select().from(commands).where(eq(commands.id, commandId))
  if (!command) throw new Error('command_missing')
  const delivery = await pool.query<{ conflict_code: string | null }>('SELECT conflict_code FROM outbox WHERE command_id=$1', [commandId])
  if (!delivery.rowCount) throw new Error('outbox_missing')
  if (delivery.rows[0].conflict_code) return 'conflict'
  verifyBytes(command.payloadBytes, command.payloadDigest)
  const args = [strictJson(command.payloadBytes.toString('utf8'))]
  try {
    await scheduler.enqueue({ workflowID: command.workflowId, workflowName: 'intakeCommand', queueName: command.queueName, appVersion: command.handlerVersion }, ...args)
  } catch (error) {
    // DBOS rejects some name/queue collisions itself. Classify from public retained state,
    // not error text/private tables; a transport failure without an existing workflow remains unacked.
    if (!await scheduler.getWorkflow(command.workflowId)) throw error
  }
  const actual = await scheduler.getWorkflow(command.workflowId)
  // ID or hash alone is never sufficient. Inspect actual function/queue/version AND all arguments.
  const versionConflict = actual?.applicationVersion !== command.handlerVersion
  let sameArguments = false
  try { sameArguments = canonical(actual?.input) === canonical(args) } catch { /* Noncanonical input is a durable conflict. */ }
  const conflict = !actual || actual.workflowName !== 'intakeCommand' || actual.workflowClassName !== '' || actual.workflowConfigName || actual.queueName !== command.queueName || versionConflict || !sameArguments
  if (conflict) {
    await pool.query('UPDATE outbox SET delivery_attempts=delivery_attempts+1, conflict_code=$2 WHERE command_id=$1 AND acked_at IS NULL', [commandId, versionConflict ? 'version_conflict' : 'payload_conflict'])
    return 'conflict'
  }
  const ack = await pool.query('UPDATE outbox SET delivery_attempts=delivery_attempts+1,acked_at=now() WHERE command_id=$1 AND conflict_code IS NULL', [commandId])
  return ack.rowCount === 1 ? 'acked' : 'conflict'
}

/** The executing worker checks its actual build; scheduler metadata is not sufficient. */
export function requireHandlerVersion(actualVersion: string, authorizedVersion: string): void {
  if (actualVersion !== authorizedVersion) throw new Error('worker_version_conflict')
}
