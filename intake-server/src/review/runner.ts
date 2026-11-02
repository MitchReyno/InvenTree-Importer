import type { Pool } from 'pg'
import { publishManualRun } from './events.ts'
import type { DBOSClient } from '@dbos-inc/dbos-sdk'
import { supportedVerificationOnly } from '../execution/effects-recovery.ts'
import { canonical, strictJson } from '@invimport/contracts/json'
import { executeDatabaseQuery, queryDatabase, transaction } from '../db/database.ts'
import { sql } from 'drizzle-orm'
import { verifyBytes } from '../db/authority.ts'
import { loadRun, snapshot } from '../execution/authority.ts'
import { attachmentVerificationOnly } from '../execution/attachment-recovery.ts'
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
  const result = await pool.query(
    `SELECT d.command_id FROM manual_dispatch d JOIN manual_run r ON r.id=d.run_id
     JOIN manual_approval a ON a.id=r.approval_id
     JOIN manual_preparation p ON p.id=a.preparation_id
     JOIN manual_prepare_command prepared ON prepared.id=p.prepare_command_id
     JOIN outbox o ON o.command_id=d.command_id
     WHERE prepared.deployment_id=$1 AND prepared.target_id=$2 AND prepared.context_id=$3
       AND o.acked_at IS NULL AND o.conflict_code IS NULL
     ORDER BY d.sequence LIMIT 10`,
    [config.deploymentId, config.profile.targetId, config.profile.contextId],
  )
  for (const row of result.rows) {
    await deliverCommand(pool, scheduler, row.command_id)
  }
  return result.rows.length
}

type ManualDispatchRow = {
  id: string
  run_id: string
  command_id: string
  actor_id: string
  recovery_bytes: Buffer
  recovery_digest: Buffer
  state: string
  payload_bytes: Buffer
  payload_digest: Buffer
  command_actor: string
  target_id: string
  target_context_id: string
  kind: string
  handler_version: string
  queue_name: string
  workflow_id: string
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
      queryDatabase(client).execute<ManualDispatchRow>(sql`
        SELECT d.*,c.payload_bytes,c.payload_digest,c.actor_id AS command_actor,c.target_id,c.target_context_id,
          c.kind,c.handler_version,c.queue_name,c.workflow_id
        FROM manual_dispatch d JOIN command c ON c.id=d.command_id
        WHERE c.workflow_id=${workflowId} FOR UPDATE OF d
      `),
    )
    const row = result.rows[0]
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
      (authority.plan.version === 'bench-effects-plan/1' &&
        (await supportedVerificationOnly(client, row.run_id, recoveryIds)))
    if (
      row.state !== 'queued' ||
      (!verificationOnly && original.state === 'recovery_required') ||
      (!verificationOnly && original.state === 'settled_complete')
    ) {
      if (row.state === 'running') {
        await client.query('UPDATE manual_dispatch SET state=$2,safe_code=$3 WHERE id=$1', [
          row.id,
          original.state === 'settled_complete' ? 'finished' : 'interrupted',
          original.state === 'settled_complete' ? null : 'original_run_inspection_required',
        ])
        await publishManualRun(client, row.run_id)
      }
      return { launch: false as const, runId: row.run_id, dispatchId: row.id, recoveryIds }
    }
    await client.query("UPDATE manual_dispatch SET state='running' WHERE id=$1", [row.id])
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
      const changed = await client.query(
        "UPDATE manual_dispatch SET state='finished',safe_code=NULL WHERE id=$1 AND state='running'",
        [retained.dispatchId],
      )
      if (changed.rowCount) {
        await publishManualRun(client, retained.runId)
      }
    })
    return result
  } catch {
    await transaction(pool, async (client) => {
      const changed = await client.query(
        "UPDATE manual_dispatch SET state='interrupted',safe_code='original_run_inspection_required' WHERE id=$1 AND state='running'",
        [retained.dispatchId],
      )
      if (changed.rowCount) {
        await publishManualRun(client, retained.runId)
      }
    })
    throw new Error('apply_interrupted_inspect_original_run')
  }
}
