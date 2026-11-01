import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { canonical } from '@invimport/contracts/json'
import { transaction } from '../db/database.ts'
import { idempotent, sha256 } from '../db/authority.ts'
import { fail } from '../capture/repository.ts'
import { selectAttachmentRecovery } from '../execution/attachment-recovery.ts'
import { cancelRun, lockRun, selectRecovery } from '../execution/authority.ts'
import { lockedCapture, type ManualConfig } from './authority.ts'
import { manualRunSnapshot, runIdentity } from './runs.ts'

export async function runCommand(
  pool: Pool,
  config: ManualConfig,
  runId: string,
  key: string,
  input: { expected_run_revision: string; operation_keys?: string[]; attachment_keys?: string[] },
  action: 'start' | 'cancel' | 'recover',
) {
  const payload = {
    ...input,
    ...(input.operation_keys ? { operation_keys: [...input.operation_keys].sort() } : {}),
    ...(input.attachment_keys ? { attachment_keys: [...input.attachment_keys].sort() } : {}),
  }
  return transaction(pool, (client) =>
    idempotent(
      client,
      {
        actorId: config.actorId,
        action: `manual_${action}`,
        resourceKey: `${config.targetId}:${config.targetContextId}:${runId}`,
        key,
      },
      payload,
      async () => {
        const identity = await runIdentity(client, config, runId)
        await lockedCapture(client, config, identity.row.batch_id)
        const authority = await lockRun(client, runId)
        const current = await manualRunSnapshot(client, config, runId)
        if (current.revision !== input.expected_run_revision) {
          fail('revision_conflict', 412)
        }
        const accepted = {
          run_id: runId,
          approval_id: current.approval_id,
          preparation_id: current.preparation_id,
        }
        if (action === 'cancel') {
          if (current.state === 'settled_complete') {
            return accepted
          }
          await cancelRun(client, runId, config.actorId)
          return accepted
        }
        if (action === 'start') {
          const existing = await client.query(
            'SELECT id FROM manual_dispatch WHERE command_id=$1',
            [authority.commandId],
          )
          if (existing.rows[0] || current.state === 'settled_complete') {
            return accepted
          }
          if (current.state !== 'queued') {
            fail('original_recovery_required', 409)
          }
          const bytes = Buffer.from(canonical([]))
          await client.query(
            'INSERT INTO manual_dispatch(id,run_id,actor_id,command_id,recovery_bytes,recovery_digest) VALUES($1,$2,$3,$4,$5,$6)',
            [randomUUID(), runId, config.actorId, authority.commandId, bytes, sha256(bytes)],
          )
          return accepted
        }
        const selected = payload.operation_keys ?? []
        const selectedAttachments = payload.attachment_keys ?? []
        if (
          (!selected.length && !selectedAttachments.length) ||
          (selected.length > 0 && selectedAttachments.length > 0) ||
          selectedAttachments.some(
            (artifactKey) =>
              !current.attachments?.find((attachment) => attachment.artifact_key === artifactKey)
                ?.recovery_action,
          ) ||
          selected.some(
            (operationKey) =>
              !current.operations.find((value) => value.operation_key === operationKey)
                ?.recovery_allowed,
          )
        ) {
          fail('create_not_recoverable', 409)
        }
        const recoveryIds: string[] = []
        for (const operationKey of selected) {
          recoveryIds.push(await selectRecovery(client, runId, operationKey, config.actorId))
        }
        for (const artifactKey of selectedAttachments) {
          recoveryIds.push(
            await selectAttachmentRecovery(client, runId, artifactKey, config.actorId),
          )
        }
        const dispatchId = randomUUID()
        const commandId = randomUUID()
        const bytes = Buffer.from(
          canonical({
            runId,
            approvalId: authority.approvalId,
            planDigest: identity.preparation.preview.plan_sha256,
            dispatchId,
            recoveryIds,
          }),
        )
        await client.query(
          `INSERT INTO command(id,actor_id,target_id,target_context_id,kind,handler_version,workflow_id,queue_name,payload_bytes,payload_digest)
       VALUES($1,$2,$3,$4,'recover',$5,$6,'bench-apply',$7,$8)`,
          [
            commandId,
            config.actorId,
            config.targetId,
            config.targetContextId,
            authority.plan.build,
            `manual-recovery:${dispatchId}`,
            bytes,
            sha256(bytes),
          ],
        )
        await client.query('INSERT INTO outbox(command_id) VALUES($1)', [commandId])
        const recoveryBytes = Buffer.from(canonical(recoveryIds))
        await client.query(
          'INSERT INTO manual_dispatch(id,run_id,actor_id,command_id,recovery_bytes,recovery_digest) VALUES($1,$2,$3,$4,$5,$6)',
          [dispatchId, runId, config.actorId, commandId, recoveryBytes, sha256(recoveryBytes)],
        )
        return accepted
      },
    ),
  )
}
