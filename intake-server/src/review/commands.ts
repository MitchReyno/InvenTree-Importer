import { eq } from 'drizzle-orm'
import { executeDatabaseQuery, queryDatabase } from '../db/database.ts'
import { commands, outbox } from '../db/schema.ts'
import { manualDispatches } from './schema.ts'
import { selectSupportedRecovery } from '../execution/effects/effects-recovery.ts'
import { publishManualRun } from './events.ts'
import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { canonical } from '@invimport/contracts/json'
import { transaction } from '../db/database.ts'
import { idempotent, sha256 } from '../db/authority.ts'
import { fail } from '../capture/model.ts'
import { selectAttachmentRecovery } from '../execution/attachments/attachment-recovery.ts'
import { cancelRun, lockRun, selectRecovery } from '../execution/authority.ts'
import { lockedCapture, type ManualConfig } from './authority.ts'
import { manualRunSnapshot, runIdentity } from './runs.ts'

export async function runCommand(
  pool: Pool,
  config: ManualConfig,
  runId: string,
  key: string,
  input: {
    expected_run_revision: string
    operation_keys?: string[]
    attachment_keys?: string[]
    effect_keys?: string[]
    assessment_keys?: string[]
  },
  action: 'start' | 'cancel' | 'recover',
) {
  const payload = {
    ...input,
    ...(input.effect_keys ? { effect_keys: [...input.effect_keys].sort() } : {}),
    ...(input.assessment_keys ? { assessment_keys: [...input.assessment_keys].sort() } : {}),
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
          await publishManualRun(client, runId)
          return accepted
        }
        if (action === 'start') {
          const existing = await executeDatabaseQuery(
            queryDatabase(client)
              .select({ id: manualDispatches.id })
              .from(manualDispatches)
              .where(eq(manualDispatches.commandId, authority.commandId)),
          )
          if (existing[0] || current.state === 'settled_complete') {
            return accepted
          }
          if (current.state !== 'queued') {
            fail('original_recovery_required', 409)
          }
          const bytes = Buffer.from(canonical([]))
          await executeDatabaseQuery(
            queryDatabase(client)
              .insert(manualDispatches)
              .values({
                id: randomUUID(),
                runId,
                actorId: config.actorId,
                commandId: authority.commandId,
                recoveryBytes: bytes,
                recoveryDigest: sha256(bytes),
              }),
          )
          await publishManualRun(client, runId)
          return accepted
        }
        const selectedEffects = payload.effect_keys ?? []
        const selectedAssessments = payload.assessment_keys ?? []
        const selected = payload.operation_keys ?? []
        const selectedAttachments = payload.attachment_keys ?? []
        if (
          (!selected.length &&
            !selectedAttachments.length &&
            !selectedEffects.length &&
            !selectedAssessments.length) ||
          [selected, selectedAttachments, selectedEffects, selectedAssessments].filter(
            (keys) => keys.length,
          ).length !== 1 ||
          selectedEffects.some(
            (key) =>
              current.supported_effects?.find((effect) => effect.operation_key === key)
                ?.recovery_action !== 'resume_effect',
          ) ||
          selectedAssessments.some(
            (key) =>
              current.supported_effects?.find((effect) => effect.operation_key === key)
                ?.recovery_action !== 'verify_effect',
          ) ||
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
        for (const effectKey of selectedEffects) {
          recoveryIds.push(
            await selectSupportedRecovery(
              client,
              runId,
              effectKey,
              config.actorId,
              'resume_effect',
            ),
          )
        }
        for (const effectKey of selectedAssessments) {
          recoveryIds.push(
            await selectSupportedRecovery(
              client,
              runId,
              effectKey,
              config.actorId,
              'verify_effect',
            ),
          )
        }
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
        await executeDatabaseQuery(
          queryDatabase(client)
            .insert(commands)
            .values({
              id: commandId,
              actorId: config.actorId,
              targetId: config.targetId,
              targetContextId: config.targetContextId,
              kind: 'recover',
              handlerVersion: authority.plan.build,
              workflowId: `manual-recovery:${dispatchId}`,
              queueName: 'bench-apply',
              payloadBytes: bytes,
              payloadDigest: sha256(bytes),
            }),
        )
        await executeDatabaseQuery(queryDatabase(client).insert(outbox).values({ commandId }))
        const recoveryBytes = Buffer.from(canonical(recoveryIds))
        await executeDatabaseQuery(
          queryDatabase(client)
            .insert(manualDispatches)
            .values({
              id: dispatchId,
              runId,
              actorId: config.actorId,
              commandId,
              recoveryBytes,
              recoveryDigest: sha256(recoveryBytes),
            }),
        )
        await publishManualRun(client, runId)
        return accepted
      },
    ),
  )
}
