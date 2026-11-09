import { isEffectsPlan } from '../execution/effects/effects-plan.ts'
import type { Pool } from 'pg'
import { publishManualRun } from './events.ts'
import type { DBOSClient } from '@dbos-inc/dbos-sdk'
import { supportedVerificationOnly } from '../execution/effects/effects-recovery.ts'
import { canonical, strictJson } from '@invimport/contracts/json'
import { executeDatabaseQuery, queryDatabase, transaction } from '../db/database.ts'
import { and, eq, isNull } from 'drizzle-orm'
import { commands, outbox } from '../db/schema.ts'
import {
  manualDispatches,
  manualRuns,
  manualApprovals,
  manualPreparations,
  manualPrepareCommands,
} from './schema.ts'
import { dispatchColumns } from './row-projections.ts'
import { verifyBytes } from '../db/authority.ts'
import { loadRun, snapshot } from '../execution/authority.ts'
import { attachmentVerificationOnly } from '../execution/attachments/attachment-recovery.ts'
import { startApply } from '../execution/supervisor.ts'
import type { TargetProfile } from '../inventory/transport.ts'
import { deliverCommand } from '../workers/delivery.ts'

export interface ManualRunnerConfig {
  runnerDatabaseUrl: string
  schedulerDatabaseUrl: string
  applyDatabaseUrl: string
  gateRoot: string
  deploymentId: string
  mediaBlobRoot?: string
  profile: TargetProfile
}

/** One bounded delivery pass. Scheduler ACK grants no physical ownership or new approved scope. */
export async function dispatchManualCommands(
  pool: Pool,
  scheduler: DBOSClient,
  config: ManualRunnerConfig,
) {
  const result = await executeDatabaseQuery(
    queryDatabase(pool)
      .select({ command_id: manualDispatches.commandId })
      .from(manualDispatches)
      .innerJoin(manualRuns, eq(manualRuns.id, manualDispatches.runId))
      .innerJoin(manualApprovals, eq(manualApprovals.id, manualRuns.approvalId))
      .innerJoin(manualPreparations, eq(manualPreparations.id, manualApprovals.preparationId))
      .innerJoin(
        manualPrepareCommands,
        eq(manualPrepareCommands.id, manualPreparations.prepareCommandId),
      )
      .innerJoin(outbox, eq(outbox.commandId, manualDispatches.commandId))
      .where(
        and(
          eq(manualPrepareCommands.deploymentId, config.deploymentId),
          eq(manualPrepareCommands.targetId, config.profile.targetId),
          eq(manualPrepareCommands.contextId, config.profile.contextId),
          isNull(outbox.ackedAt),
          isNull(outbox.conflictCode),
        ),
      )
      .orderBy(manualDispatches.sequence)
      .limit(10),
  )
  for (const row of result) {
    await deliverCommand(pool, scheduler, row.command_id)
  }
  return result.length
}

/** A resumed scheduler step is inspection-only once a dispatch was claimed.
 * Only a new explicit original-run recovery selection can authorize further attempts.
 */
export async function executeManualDispatch(
  pool: Pool,
  config: ManualRunnerConfig,
  workflowId: string,
  payload: unknown,
) {
  const retained = await transaction(pool, async (client) => {
    const result = await executeDatabaseQuery(
      queryDatabase(client)
        .select({
          ...dispatchColumns,
          payload_bytes: commands.payloadBytes,
          payload_digest: commands.payloadDigest,
          command_actor: commands.actorId,
          target_id: commands.targetId,
          target_context_id: commands.targetContextId,
          kind: commands.kind,
          handler_version: commands.handlerVersion,
          queue_name: commands.queueName,
          workflow_id: commands.workflowId,
        })
        .from(manualDispatches)
        .innerJoin(commands, eq(commands.id, manualDispatches.commandId))
        .where(eq(commands.workflowId, workflowId))
        .for('update', { of: manualDispatches }),
    )
    const row = result[0]
    if (!row) {
      throw new Error('manual_dispatch_authority_missing')
    }
    verifyBytes(row.payload_bytes, row.payload_digest)
    verifyBytes(row.recovery_bytes, row.recovery_digest)
    const authority = await loadRun(client, row.run_id)
    if (
      row.command_actor !== row.actor_id ||
      row.actor_id !== authority.actorId ||
      row.target_id !== config.profile.targetId ||
      row.target_context_id !== config.profile.contextId ||
      authority.plan.deploymentId !== config.deploymentId ||
      row.handler_version !== authority.plan.build ||
      row.queue_name !== 'bench-apply' ||
      canonical(payload) !== row.payload_bytes.toString('utf8')
    ) {
      throw new Error('manual_dispatch_binding_mismatch')
    }
    const recovery: unknown = strictJson(row.recovery_bytes.toString('utf8'))
    if (!Array.isArray(recovery) || recovery.some((value) => typeof value !== 'string')) {
      throw new Error('manual_dispatch_binding_mismatch')
    }
    const recoveryIds = recovery as string[]
    const approvalDigest = authority.planDigest
    const expected = recoveryIds.length
      ? {
          runId: row.run_id,
          approvalId: authority.approvalId,
          planDigest: approvalDigest,
          dispatchId: row.id,
          recoveryIds,
        }
      : { runId: row.run_id, approvalId: authority.approvalId, planDigest: approvalDigest }
    if (
      canonical(expected) !== row.payload_bytes.toString('utf8') ||
      (recoveryIds.length
        ? row.kind !== 'recover' || row.workflow_id !== `manual-recovery:${row.id}`
        : row.kind !== 'apply' || row.command_id !== authority.commandId)
    ) {
      throw new Error('manual_dispatch_binding_mismatch')
    }
    const original = await snapshot(client, row.run_id)
    const verificationOnly =
      (authority.plan.version !== 'bench-stock-plan/1' &&
        (await attachmentVerificationOnly(client, row.run_id, recoveryIds))) ||
      (isEffectsPlan(authority.plan) &&
        (await supportedVerificationOnly(client, row.run_id, recoveryIds)))
    if (
      row.state !== 'queued' ||
      (!verificationOnly && original.state === 'recovery_required') ||
      (!verificationOnly && original.state === 'settled_complete')
    ) {
      if (row.state === 'running') {
        await executeDatabaseQuery(
          queryDatabase(client)
            .update(manualDispatches)
            .set({
              state: original.state === 'settled_complete' ? 'finished' : 'interrupted',
              safeCode:
                original.state === 'settled_complete' ? null : 'original_run_inspection_required',
            })
            .where(eq(manualDispatches.id, row.id)),
        )
        await publishManualRun(client, row.run_id)
      }
      return { launch: false as const, runId: row.run_id, dispatchId: row.id, recoveryIds }
    }
    await executeDatabaseQuery(
      queryDatabase(client)
        .update(manualDispatches)
        .set({ state: 'running' })
        .where(eq(manualDispatches.id, row.id)),
    )
    await publishManualRun(client, row.run_id)
    return { launch: true as const, runId: row.run_id, dispatchId: row.id, recoveryIds }
  })
  if (!retained.launch) {
    return snapshot(pool, retained.runId)
  }
  try {
    const supervised = await startApply({
      databaseUrl: config.applyDatabaseUrl,
      gateRoot: config.gateRoot,
      runId: retained.runId,
      profile: config.profile,
      mediaBlobRoot: config.mediaBlobRoot,
      recoveryIds: retained.recoveryIds,
    })
    const result = await supervised.completed
    await transaction(pool, async (client) => {
      const changed = await executeDatabaseQuery(
        queryDatabase(client)
          .update(manualDispatches)
          .set({ state: 'finished', safeCode: null })
          .where(
            and(
              eq(manualDispatches.id, retained.dispatchId),
              eq(manualDispatches.state, 'running'),
            ),
          ),
      )
      if (changed.rowCount) {
        await publishManualRun(client, retained.runId)
      }
    })
    return result
  } catch {
    await transaction(pool, async (client) => {
      const changed = await executeDatabaseQuery(
        queryDatabase(client)
          .update(manualDispatches)
          .set({ state: 'interrupted', safeCode: 'original_run_inspection_required' })
          .where(
            and(
              eq(manualDispatches.id, retained.dispatchId),
              eq(manualDispatches.state, 'running'),
            ),
          ),
      )
      if (changed.rowCount) {
        await publishManualRun(client, retained.runId)
      }
    })
    throw new Error('apply_interrupted_inspect_original_run')
  }
}
