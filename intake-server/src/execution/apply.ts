import { isEffectsPlan } from './effects-plan.ts'
import { cancellationVersion } from './cancellation.ts'
import { applySupportedEffects } from './effects-apply.ts'
import type { BlobStore } from '../media/blob-store.ts'
import { applyAttachments } from './attachment-apply.ts'
import type { AttachmentRecovery } from './attachment-recovery.ts'
import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { executeDatabaseQuery, queryDatabase } from '../db/database.ts'
import {
  executorDeployments,
  executorGuards,
  executorRecoveries,
  executorIntents,
  executorEffects,
  executorResults,
  executorApprovals,
  executorAttachmentRecoveries,
} from './schema.ts'
import { canonical } from '@invimport/contracts/json'
import { executorTransaction as transaction } from './transaction.ts'
import { sha256 } from '../db/authority.ts'
import { inventoryTransport, type TargetProfile } from '../inventory/transport.ts'
import { loadRun, lockRun, snapshot, type RunAuthority } from './authority.ts'
import { stockBytes, type StockOperation } from './plan.ts'
import { ExternalGate, WriterConnection } from './ownership.ts'
import { inventoryBody, responseObject, responsePk, stockMatches } from './response.ts'

export type Checkpoint = 'before_authorize' | 'intent_committed' | 'result_committed'
export interface ApplyDependencies {
  pool: Pool
  writer: WriterConnection
  gate: ExternalGate
  claimToken: string
  profile: TargetProfile
  stopped: () => boolean
  mediaStore?: BlobStore
  checkpoint?: (phase: Checkpoint, kind: string, intentId?: string) => Promise<void>
}

/** One serial physical child only. Callers cannot supply a URL, raw request or new approval.
 * Journal errors propagate; in particular a failed COMMIT acknowledgment NEVER leads to a send.
 */
export async function executeRun(
  deps: ApplyDependencies,
  runId: string,
  recoveryIds: readonly string[] = [],
) {
  const { pool, writer, gate, claimToken, profile } = deps
  let authority = await loadRun(pool, runId)
  const deployment = (
    await executeDatabaseQuery(
      queryDatabase(pool)
        .select({ origin: executorDeployments.origin })
        .from(executorDeployments)
        .where(eq(executorDeployments.id, authority.plan.deploymentId)),
    )
  )[0]
  if (
    profile.origin !== deployment.origin ||
    profile.targetId !== authority.plan.targetId ||
    profile.contextId !== authority.plan.contextId ||
    profile.kind !== 'owned-disposable'
  ) {
    throw new Error('apply_profile_mismatch')
  }
  if (
    authority.plan.version === 'bench-media-plan/1' ||
    (isEffectsPlan(authority.plan) && authority.plan.mediaConfigured)
  ) {
    if (profile.attachmentCapability !== 'owned-fake-media/1' || !deps.mediaStore) {
      throw new Error('media_apply_capability_unavailable')
    }
    // All supporting bytes must be present and verified before even the first stock POST.
    for (const evidence of authority.plan.evidence) {
      const bytes = await deps.mediaStore.read(evidence.blobDigest)
      if (String(bytes.length) !== evidence.byteSize) {
        throw new Error('approved_media_size_changed')
      }
    }
  }
  const transport = inventoryTransport(profile)

  async function health() {
    if (deps.stopped()) {
      throw new Error('apply_stopping')
    }
    await gate.requireClaim(claimToken)
    await writer.check()
    await gate.check(pool, authority.plan)
  }

  await health()
  if (isEffectsPlan(authority.plan)) {
    return applySupportedEffects(deps, runId, authority.plan, recoveryIds, health)
  }

  async function request(
    operation: StockOperation,
    kind: 'get_part' | 'get_location' | 'create_stock',
    bytes: Buffer,
    recoveryId: string | null,
    send: () => Promise<Response>,
  ): Promise<{ status: number; bytes: Buffer } | null> {
    await deps.checkpoint?.('before_authorize', kind)
    await health()
    const intentId = randomUUID()
    const authorized = await transaction(pool, async (client) => {
      authority = await lockRun(client, runId)
      await health()
      if ((await snapshot(client, runId)).state === 'recovery_required') {
        return false
      }
      const guard = (
        await executeDatabaseQuery(
          queryDatabase(client)
            .select({ activeRun: executorGuards.activeRun })
            .from(executorGuards)
            .where(
              and(
                eq(executorGuards.targetId, authority.plan.targetId),
                eq(executorGuards.originalKey, authority.plan.originalSourceKey),
              ),
            ),
        )
      )[0]
      if (guard.activeRun !== runId) {
        throw new Error('source_not_owned')
      }
      const cancelVersion = await cancellationVersion(client, runId)
      if (cancelVersion !== '0' && !recoveryId) {
        return false
      }
      if (recoveryId) {
        const selected = await executeDatabaseQuery(
          queryDatabase(client)
            .select({ cancelVersion: executorRecoveries.cancelVersion })
            .from(executorRecoveries)
            .where(
              and(
                eq(executorRecoveries.id, recoveryId),
                eq(executorRecoveries.runId, runId),
                eq(executorRecoveries.operationKey, operation.operationKey),
              ),
            ),
        )
        if (!selected.length) {
          throw new Error('recovery_authority_missing')
        }
        if (selected[0].cancelVersion.toString() !== cancelVersion) {
          return false
        }
      }
      const attempts = await executeDatabaseQuery(
        queryDatabase(client)
          .select({
            recovery_id: executorIntents.recoveryId,
            certainty: executorEffects.certainty,
            outcome: executorResults.outcome,
          })
          .from(executorIntents)
          .leftJoin(executorEffects, eq(executorEffects.intentId, executorIntents.id))
          .leftJoin(executorResults, eq(executorResults.intentId, executorIntents.id))
          .where(
            and(
              eq(executorIntents.runId, runId),
              eq(executorIntents.operationKey, operation.operationKey),
              eq(executorIntents.kind, kind),
            ),
          )
          .orderBy(asc(executorIntents.attempt)),
      )
      if (
        attempts.length &&
        (!recoveryId || attempts.some((row) => row.recovery_id === recoveryId))
      ) {
        throw new Error('selected_recovery_required')
      }
      if (
        kind === 'create_stock' &&
        attempts.some((row) => row.certainty !== 'none' || row.outcome !== 'proven_not_sent')
      ) {
        throw new Error('create_not_recoverable')
      }
      await executeDatabaseQuery(
        queryDatabase(client)
          .insert(executorIntents)
          .values({
            id: intentId,
            runId,
            operationKey: operation.operationKey,
            attempt: attempts.length + 1,
            recoveryId,
            kind,
            requestBytes: bytes,
            requestDigest: sha256(bytes),
          }),
      )
      return true
    })
    if (!authorized) {
      return null
    }
    await deps.checkpoint?.('intent_committed', kind, intentId)
    // A crash or lock loss after authorization is UNKNOWN, never automatically retried.
    // A positive local refusal before dispatch can be checkpointed as no effect.
    try {
      await health()
    } catch {
      await checkpoint(intentId, operation, kind, 'proven_not_sent', null, null, 'none', null)
      return null
    }
    if (kind === 'create_stock') {
      const row = (
        await executeDatabaseQuery(
          queryDatabase(pool)
            .select({ planDigest: executorApprovals.planDigest })
            .from(executorApprovals)
            .where(eq(executorApprovals.id, authority.approvalId)),
        )
      )[0]
      await gate.witness(intentId, row.planDigest, sha256(bytes), authority.plan.deploymentId)
      await health()
    }
    let received: { status: number; bytes: Buffer }
    try {
      const response = await send()
      received = { status: response.status, bytes: await inventoryBody(response) }
    } catch {
      await checkpoint(
        intentId,
        operation,
        kind,
        'transport_loss',
        null,
        null,
        kind === 'create_stock' ? 'unknown' : 'none',
        null,
      )
      return null
    }
    let certainty: 'confirmed' | 'unknown' | 'none' = kind === 'create_stock' ? 'unknown' : 'none'
    let remotePk: string | null = null
    if (kind === 'create_stock') {
      try {
        const value = responseObject(received.bytes)
        // Preserve a trustworthy returned PK even if other fields are incomplete.
        remotePk = responsePk(value.pk)
        if (received.status === 201 && stockMatches(value, operation)) {
          certainty = 'confirmed'
        }
      } catch {
        /* Response alone did not establish the complete output contract. */
      }
    }
    await checkpoint(
      intentId,
      operation,
      kind,
      'response',
      received.status,
      received.bytes,
      certainty,
      remotePk,
    )
    return received
  }

  async function checkpoint(
    intentId: string,
    operation: StockOperation,
    kind: string,
    outcome: string,
    status: number | null,
    bytes: Buffer | null,
    certainty: string,
    remotePk: string | null,
  ) {
    await transaction(pool, async (client) => {
      await lockRun(client, runId)
      await executeDatabaseQuery(
        queryDatabase(client)
          .insert(executorResults)
          .values({ intentId, outcome, status, responseBytes: bytes }),
      )
      if (kind === 'create_stock') {
        await executeDatabaseQuery(
          queryDatabase(client)
            .insert(executorEffects)
            .values({ intentId, runId, operationKey: operation.operationKey, certainty, remotePk }),
        )
      }
    })
    await deps.checkpoint?.('result_committed', kind, intentId)
  }

  const selected = await executeDatabaseQuery(
    queryDatabase(pool)
      .select({
        id: executorRecoveries.id,
        run_id: executorRecoveries.runId,
        operation_key: executorRecoveries.operationKey,
      })
      .from(executorRecoveries)
      .where(inArray(executorRecoveries.id, [...recoveryIds])),
  )
  const attachmentRecoveries: AttachmentRecovery[] =
    authority.plan.version === 'bench-media-plan/1'
      ? (
          await executeDatabaseQuery(
            queryDatabase(pool)
              .select({
                id: executorAttachmentRecoveries.id,
                run_id: executorAttachmentRecoveries.runId,
                artifact_key: executorAttachmentRecoveries.artifactKey,
                kind: executorAttachmentRecoveries.kind,
                create_intent_id: executorAttachmentRecoveries.createIntentId,
                cancel_version: executorAttachmentRecoveries.cancelVersion,
              })
              .from(executorAttachmentRecoveries)
              .where(inArray(executorAttachmentRecoveries.id, [...recoveryIds])),
          )
        ).map((row) => ({ ...row, cancel_version: row.cancel_version.toString() }))
      : []
  const allSelected = [...selected, ...attachmentRecoveries]
  if (
    allSelected.length !== recoveryIds.length ||
    allSelected.some((row) => row.run_id !== runId)
  ) {
    throw new Error('recovery_scope_mismatch')
  }
  for (const operation of authority.plan.operations) {
    const recovery = selected.find((row) => row.operation_key === operation.operationKey)
    if (recoveryIds.length && !recovery) {
      continue
    }
    const current = (await snapshot(pool, runId)).operations.find(
      (row) => row.operationKey === operation.operationKey,
    )!
    if (current.certainty === 'confirmed') {
      continue
    }
    if (current.certainty === 'unknown') {
      break
    }
    const reads = [
      { kind: 'get_part' as const, pk: operation.part },
      ...(operation.location === null
        ? []
        : [{ kind: 'get_location' as const, pk: operation.location }]),
    ]
    let preconditions = true
    for (const read of reads) {
      const result = await request(
        operation,
        read.kind,
        Buffer.from(canonical(read)),
        recovery?.id ?? null,
        () => transport.read(authority.plan, read),
      )
      try {
        if (
          !result ||
          result.status !== 200 ||
          responsePk(responseObject(result.bytes).pk) !== read.pk
        ) {
          preconditions = false
          break
        }
      } catch {
        preconditions = false
        break
      }
    }
    if (!preconditions) {
      break
    }
    await request(operation, 'create_stock', stockBytes(operation), recovery?.id ?? null, () =>
      transport.sendStock(authority.plan, stockBytes(operation).toString('utf8')),
    )
    if ((await snapshot(pool, runId)).operations.some((row) => row.certainty === 'unknown')) {
      break
    }
  }
  if (authority.plan.version === 'bench-media-plan/1') {
    await applyAttachments(
      deps,
      runId,
      transport,
      attachmentRecoveries,
      recoveryIds.length > 0,
      health,
    )
  }
  return settle(pool, authority)
}

async function settle(pool: Pool, authority: RunAuthority) {
  return transaction(pool, async (client) => {
    await lockRun(client, authority.runId)
    const result = await snapshot(client, authority.runId)
    // A safe partial run may release for NEW contributions; prior operations stay pinned.
    if (result.state === 'settled_complete' || result.state === 'settled_incomplete') {
      await executeDatabaseQuery(
        queryDatabase(client)
          .update(executorGuards)
          .set({ activeRun: null })
          .where(
            and(
              eq(executorGuards.targetId, authority.plan.targetId),
              eq(executorGuards.originalKey, authority.plan.originalSourceKey),
              eq(executorGuards.activeRun, authority.runId),
            ),
          ),
      )
    }
    return result
  })
}
