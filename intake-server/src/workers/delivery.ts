import type { DBOSClient } from '@dbos-inc/dbos-sdk'
import type { Pool } from 'pg'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { canonical, strictJson } from '@invimport/contracts/json'
import { executeDatabaseQuery, queryDatabase } from '../db/database.ts'
import { commands, outbox, type CommandRow } from '../db/schema.ts'
import { verifyBytes } from '../db/authority.ts'

type DeliveryConflict = 'payload_conflict' | 'version_conflict'
type WorkflowStatus = Awaited<ReturnType<DBOSClient['getWorkflow']>>

async function readDeliveryCommand(pool: Pool, commandId: string): Promise<CommandRow> {
  const matchingCommands = await executeDatabaseQuery(
    queryDatabase(pool).select().from(commands).where(eq(commands.id, commandId)),
  )
  const command = matchingCommands[0]
  if (!command) {
    throw new Error('command_missing')
  }
  return command
}

async function readDeliveryConflict(pool: Pool, commandId: string) {
  const deliveries = await executeDatabaseQuery(
    queryDatabase(pool)
      .select({ conflictCode: outbox.conflictCode })
      .from(outbox)
      .where(eq(outbox.commandId, commandId)),
  )
  const delivery = deliveries[0]
  if (!delivery) {
    throw new Error('outbox_missing')
  }
  return delivery.conflictCode
}

async function enqueueOrInspectExisting(
  scheduler: DBOSClient,
  command: CommandRow,
  args: unknown[],
): Promise<WorkflowStatus> {
  try {
    await scheduler.enqueue(
      {
        workflowID: command.workflowId,
        workflowName: 'intakeCommand',
        queueName: command.queueName,
        appVersion: command.handlerVersion,
      },
      ...args,
    )
  } catch (error) {
    // Classify DBOS collisions from public retained state, never error text/private tables.
    // A transport failure without an existing workflow remains unacked.
    const existing = await scheduler.getWorkflow(command.workflowId)
    if (!existing) {
      throw error
    }
  }
  return scheduler.getWorkflow(command.workflowId)
}

function workflowConflict(
  actual: WorkflowStatus,
  command: CommandRow,
  args: unknown[],
): DeliveryConflict | undefined {
  if (actual?.applicationVersion !== command.handlerVersion) {
    return 'version_conflict'
  }

  const sameIdentity =
    actual.workflowName === 'intakeCommand' &&
    actual.workflowClassName === '' &&
    !actual.workflowConfigName &&
    actual.queueName === command.queueName
  if (!sameIdentity) {
    return 'payload_conflict'
  }

  // ID or digest alone cannot establish equivalence: compare every retained argument.
  try {
    if (canonical(actual.input) === canonical(args)) {
      return undefined
    }
  } catch {
    // Noncanonical input remains a durable conflict.
  }
  return 'payload_conflict'
}

async function retainDeliveryConflict(
  pool: Pool,
  commandId: string,
  conflictCode: DeliveryConflict,
): Promise<void> {
  await executeDatabaseQuery(
    queryDatabase(pool)
      .update(outbox)
      .set({
        deliveryAttempts: sql`${outbox.deliveryAttempts} + 1`,
        conflictCode,
      })
      .where(and(eq(outbox.commandId, commandId), isNull(outbox.ackedAt))),
  )
}

async function acknowledgeDelivery(pool: Pool, commandId: string): Promise<'acked' | 'conflict'> {
  const acknowledgement = await executeDatabaseQuery(
    queryDatabase(pool)
      .update(outbox)
      .set({
        deliveryAttempts: sql`${outbox.deliveryAttempts} + 1`,
        ackedAt: sql`now()`,
      })
      .where(and(eq(outbox.commandId, commandId), isNull(outbox.conflictCode))),
  )
  return acknowledgement.rowCount === 1 ? 'acked' : 'conflict'
}

/** One bounded delivery, no daemon/worker/claim ownership. The outbox owns redelivery, never physical writes. */
export async function deliverCommand(
  pool: Pool,
  scheduler: DBOSClient,
  commandId: string,
): Promise<'acked' | 'conflict'> {
  const command = await readDeliveryCommand(pool, commandId)
  const priorConflict = await readDeliveryConflict(pool, commandId)
  if (priorConflict) {
    return 'conflict'
  }

  verifyBytes(command.payloadBytes, command.payloadDigest)
  const args = [strictJson(command.payloadBytes.toString('utf8'))]
  const actual = await enqueueOrInspectExisting(scheduler, command, args)
  const conflict = workflowConflict(actual, command, args)
  if (conflict) {
    await retainDeliveryConflict(pool, commandId, conflict)
    return 'conflict'
  }
  return acknowledgeDelivery(pool, commandId)
}

/** The executing worker checks its actual build; scheduler metadata is not sufficient. */
export function requireHandlerVersion(actualVersion: string, authorizedVersion: string): void {
  if (actualVersion !== authorizedVersion) {
    throw new Error('worker_version_conflict')
  }
}
