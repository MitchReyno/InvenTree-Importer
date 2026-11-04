import { isEffectsPlan } from './effects-plan.ts'
import { cancellationVersion } from './cancellation.ts'
import { stockIndexBytes } from './effects-output.ts'
import { supportedStates } from './effects-state.ts'
import { retainSupportedIndex, requireSupportedIndex } from './effects-index.ts'
import { canonical as canonicalStock } from '@invimport/contracts/json'
import { randomUUID } from 'node:crypto'
import type { PoolClient, Pool } from 'pg'
import { canonical } from '@invimport/contracts/json'
import { and, eq, inArray } from 'drizzle-orm'
import { sha256, verifyBytes } from '../db/authority.ts'
import { executeDatabaseQuery, queryDatabase } from '../db/database.ts'
import {
  supportedIntents,
  executorSources,
  executorGuards,
  executorApprovals,
  executorRuns,
  executorOperations,
  executorCancels,
  executorRecoveries,
  executorIntents,
  executorResults,
  executorEffects,
} from './schema.ts'
import { commands, outbox, targets } from '../db/schema.ts'
import { stockBytes, id } from './plan.ts'
import { decodeExecutablePlan, type ExecutablePlan } from './media-plan.ts'
import { attachmentStates, type AttachmentState } from './attachment-state.ts'
import {
  lockApprovedMedia,
  retainApprovedMediaPins,
  requireApprovedMediaPins,
} from '../media/execution-pins.ts'
import { retainAttachmentIndex, requireAttachmentIndex } from './attachment-index.ts'

const approvalColumns = {
  id: executorApprovals.id,
  preparation_id: executorApprovals.preparationId,
  actor_id: executorApprovals.actorId,
  deployment_id: executorApprovals.deploymentId,
  target_id: executorApprovals.targetId,
  context_id: executorApprovals.contextId,
  source_id: executorApprovals.sourceId,
  original_key: executorApprovals.originalKey,
  plan_bytes: executorApprovals.planBytes,
  plan_digest: executorApprovals.planDigest,
}

const operationColumns = {
  operation_key: executorOperations.operationKey,
  contribution_key: executorOperations.contributionKey,
  original_key: executorOperations.originalKey,
  target_id: executorOperations.targetId,
  request_bytes: executorOperations.requestBytes,
  request_digest: executorOperations.requestDigest,
}

export interface Reservation {
  approvalId: string
  preparationId: string
  runId: string
  commandId: string
  actorId: string
  bytes: Buffer
  digest: Buffer
}
export interface RunAuthority {
  runId: string
  approvalId: string
  commandId: string
  actorId: string
  plan: ExecutablePlan
  planDigest: string
}

/** Source owner invokes this ONLY with retained original capture/lineage authority.
 * No browser-supplied alias/new namespace is accepted as evidence of a fresh source.
 * Provision separately from the approval/apply roles; neither can enroll its own sources.
 */
export async function retainOriginalSource(
  client: PoolClient,
  input: { targetId: string; sourceId: string; originalSourceKey: string },
): Promise<void> {
  id(input.targetId)
  id(input.sourceId)
  id(input.originalSourceKey)
  await executeDatabaseQuery(
    queryDatabase(client)
      .insert(executorSources)
      .values({
        targetId: input.targetId,
        sourceId: input.sourceId,
        originalKey: input.originalSourceKey,
      })
      .onConflictDoNothing(),
  )
  const stored = (
    await executeDatabaseQuery(
      queryDatabase(client)
        .select({ original_key: executorSources.originalKey })
        .from(executorSources)
        .where(
          and(
            eq(executorSources.targetId, input.targetId),
            eq(executorSources.sourceId, input.sourceId),
          ),
        ),
    )
  )[0]
  if (!stored || stored.original_key !== input.originalSourceKey) {
    throw new Error('original_source_binding_conflict')
  }
}

export async function checkDeployment(client: Pick<PoolClient, 'query'>, plan: ExecutablePlan) {
  const result = await client.query(
    `SELECT d.*, t.current_context_id,t.profile FROM executor_deployment d JOIN target t ON t.id=d.target_id WHERE d.id=$1`,
    [plan.deploymentId],
  )
  const row = result.rows[0]
  if (
    !row ||
    row.target_id !== plan.targetId ||
    row.context_id !== plan.contextId ||
    row.current_context_id !== plan.contextId ||
    row.profile !== 'owned-disposable' ||
    row.epoch !== plan.epoch ||
    row.build !== plan.build ||
    row.continuity !== plan.continuity ||
    row.capability !== plan.capability
  ) {
    throw new Error('deployment_binding_mismatch')
  }
  return row as { origin: string; epoch: string; id: string }
}

/** T04 calls inside its approval transaction AFTER current draft/review/actor checks.
 * This seam does not itself approve a draft, register a source, or commit the transaction.
 */
export async function reserveApprovedStock(
  client: PoolClient,
  input: Reservation,
): Promise<{ runId: string; commandId: string; approvalId: string }> {
  for (const key of ['approvalId', 'preparationId', 'runId', 'commandId', 'actorId'] as const) {
    id(input[key])
  }
  const plan = decodeExecutablePlan(input.bytes, input.digest)
  await executeDatabaseQuery(
    queryDatabase(client)
      .select({ id: targets.id })
      .from(targets)
      .where(eq(targets.id, plan.targetId))
      .for('update'),
  )
  await checkDeployment(client, plan)
  const source = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ id: executorSources.sourceId })
      .from(executorSources)
      .where(
        and(
          eq(executorSources.targetId, plan.targetId),
          eq(executorSources.sourceId, plan.sourceId),
          eq(executorSources.originalKey, plan.originalSourceKey),
        ),
      ),
  )
  if (!source.length) {
    throw new Error('original_source_authority_missing')
  }
  await executeDatabaseQuery(
    queryDatabase(client)
      .insert(executorGuards)
      .values({ targetId: plan.targetId, originalKey: plan.originalSourceKey })
      .onConflictDoNothing(),
  )
  const guardRows = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ active_run: executorGuards.activeRun })
      .from(executorGuards)
      .where(
        and(
          eq(executorGuards.targetId, plan.targetId),
          eq(executorGuards.originalKey, plan.originalSourceKey),
        ),
      )
      .for('update'),
  )
  const guard = guardRows[0]
  const prior = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ ...approvalColumns, run_id: executorRuns.id, command_id: executorRuns.commandId })
      .from(executorApprovals)
      .innerJoin(executorRuns, eq(executorRuns.approvalId, executorApprovals.id))
      .where(eq(executorApprovals.preparationId, input.preparationId)),
  )
  if (prior.length) {
    const row = prior[0]
    verifyBytes(row.plan_bytes, row.plan_digest)
    if (row.actor_id !== input.actorId || !row.plan_bytes.equals(input.bytes)) {
      throw new Error('approval_payload_conflict')
    }
    await loadRun(client, row.run_id)
    return { runId: row.run_id, commandId: row.command_id, approvalId: row.id }
  }
  if (guard.active_run) {
    throw new Error('source_reserved')
  }
  // Never infer a clean source merely from its current guard pointer.
  const previousRuns = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ id: executorRuns.id })
      .from(executorRuns)
      .where(
        and(
          eq(executorRuns.targetId, plan.targetId),
          eq(executorRuns.originalKey, plan.originalSourceKey),
        ),
      ),
  )
  for (const previous of previousRuns) {
    const state = (await snapshot(client, previous.id)).state
    if (state === 'recovery_required' || state === 'queued') {
      throw new Error('source_history_unsettled')
    }
  }
  // A previous approved contribution blocks even when its stock no longer exists.
  const history = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ contribution_key: executorOperations.contributionKey })
      .from(executorOperations)
      .where(
        and(
          eq(executorOperations.targetId, plan.targetId),
          inArray(
            executorOperations.contributionKey,
            plan.operations.map((value) => value.contributionKey),
          ),
        ),
      ),
  )
  if (history.length) {
    throw new Error('original_contribution_already_approved')
  }
  const mediaBatchId =
    plan.version === 'bench-media-plan/1' || (isEffectsPlan(plan) && plan.mediaConfigured)
      ? await lockApprovedMedia(client, input.actorId, plan)
      : null
  await executeDatabaseQuery(
    queryDatabase(client).insert(executorApprovals).values({
      id: input.approvalId,
      preparationId: input.preparationId,
      actorId: input.actorId,
      deploymentId: plan.deploymentId,
      targetId: plan.targetId,
      contextId: plan.contextId,
      sourceId: plan.sourceId,
      originalKey: plan.originalSourceKey,
      planBytes: input.bytes,
      planDigest: input.digest,
    }),
  )
  const payload = Buffer.from(
    canonical({
      runId: input.runId,
      approvalId: input.approvalId,
      planDigest: input.digest.toString('hex'),
    }),
  )
  await executeDatabaseQuery(
    queryDatabase(client)
      .insert(commands)
      .values({
        id: input.commandId,
        actorId: input.actorId,
        targetId: plan.targetId,
        targetContextId: plan.contextId,
        kind: 'apply',
        handlerVersion: plan.build,
        workflowId: `stock:${input.runId}`,
        queueName: 'bench-apply',
        payloadBytes: payload,
        payloadDigest: sha256(payload),
      }),
  )
  await executeDatabaseQuery(
    queryDatabase(client).insert(outbox).values({ commandId: input.commandId }),
  )
  await executeDatabaseQuery(
    queryDatabase(client).insert(executorRuns).values({
      id: input.runId,
      approvalId: input.approvalId,
      commandId: input.commandId,
      targetId: plan.targetId,
      originalKey: plan.originalSourceKey,
    }),
  )
  for (const operation of plan.operations) {
    const bytes = stockIndexBytes(operation, stockBytes, canonicalStock)
    await executeDatabaseQuery(
      queryDatabase(client)
        .insert(executorOperations)
        .values({
          runId: input.runId,
          operationKey: operation.operationKey,
          targetId: plan.targetId,
          originalKey: plan.originalSourceKey,
          contributionKey: operation.contributionKey,
          requestBytes: bytes,
          requestDigest: sha256(bytes),
        }),
    )
  }
  if (isEffectsPlan(plan)) {
    await retainSupportedIndex(client, input.runId, plan)
  }
  if (plan.version !== 'bench-stock-plan/1') {
    await retainAttachmentIndex(client, input.runId, plan)
    if (!mediaBatchId && (plan.version === 'bench-media-plan/1' || plan.mediaConfigured)) {
      throw new Error('media_source_authority_missing')
    }
    if (mediaBatchId) {
      await retainApprovedMediaPins(client, input.approvalId, mediaBatchId, plan)
    }
  }
  await executeDatabaseQuery(
    queryDatabase(client)
      .update(executorGuards)
      .set({ activeRun: input.runId })
      .where(
        and(
          eq(executorGuards.targetId, plan.targetId),
          eq(executorGuards.originalKey, plan.originalSourceKey),
        ),
      ),
  )
  return { runId: input.runId, commandId: input.commandId, approvalId: input.approvalId }
}

/** Every start/adopt and authorization rechecks ALL retained bindings, not just a run status. */
export async function loadRun(client: Pool | PoolClient, runId: string): Promise<RunAuthority> {
  id(runId)
  const result = await executeDatabaseQuery(
    queryDatabase(client)
      .select({
        ...approvalColumns,
        command_id: executorRuns.commandId,
        payload_bytes: commands.payloadBytes,
        payload_digest: commands.payloadDigest,
        handler_version: commands.handlerVersion,
        command_actor: commands.actorId,
        command_target: commands.targetId,
        target_context_id: commands.targetContextId,
        kind: commands.kind,
        workflow_id: commands.workflowId,
        queue_name: commands.queueName,
      })
      .from(executorRuns)
      .innerJoin(executorApprovals, eq(executorApprovals.id, executorRuns.approvalId))
      .innerJoin(commands, eq(commands.id, executorRuns.commandId))
      .where(eq(executorRuns.id, runId)),
  )
  const row = result[0]
  if (!row) {
    throw new Error('run_authority_missing')
  }
  const plan = decodeExecutablePlan(row.plan_bytes, row.plan_digest)
  await checkDeployment(client, plan)
  verifyBytes(row.payload_bytes, row.payload_digest)
  const expected = Buffer.from(
    canonical({ runId, approvalId: row.id, planDigest: row.plan_digest.toString('hex') }),
  )
  if (
    !row.payload_bytes.equals(expected) ||
    row.kind !== 'apply' ||
    row.workflow_id !== `stock:${runId}` ||
    row.queue_name !== 'bench-apply' ||
    row.handler_version !== plan.build ||
    row.command_actor !== row.actor_id ||
    row.command_target !== plan.targetId ||
    row.target_context_id !== plan.contextId ||
    row.target_id !== plan.targetId ||
    row.context_id !== plan.contextId ||
    row.source_id !== plan.sourceId ||
    row.original_key !== plan.originalSourceKey ||
    row.deployment_id !== plan.deploymentId
  ) {
    throw new Error('command_authority_mismatch')
  }
  const operations = await executeDatabaseQuery(
    queryDatabase(client)
      .select(operationColumns)
      .from(executorOperations)
      .where(eq(executorOperations.runId, runId)),
  )
  if (operations.length !== plan.operations.length) {
    throw new Error('operation_authority_missing')
  }
  for (const operation of plan.operations) {
    const stored = operations.find((value) => value.operation_key === operation.operationKey)
    if (
      !stored ||
      stored.contribution_key !== operation.contributionKey ||
      stored.original_key !== plan.originalSourceKey ||
      stored.target_id !== plan.targetId
    ) {
      throw new Error('operation_binding_mismatch')
    }
    verifyBytes(stored.request_bytes, stored.request_digest)
    if (!stored.request_bytes.equals(stockIndexBytes(operation, stockBytes, canonicalStock))) {
      throw new Error('operation_bytes_mismatch')
    }
  }
  if (isEffectsPlan(plan)) {
    await requireSupportedIndex(client, runId, plan)
  }
  await requireAttachmentIndex(client, runId, plan)
  if (plan.version !== 'bench-stock-plan/1') {
    await requireApprovedMediaPins(client, row.id, plan)
  }
  return {
    runId,
    approvalId: row.id,
    commandId: row.command_id,
    actorId: row.actor_id,
    plan,
    planDigest: row.plan_digest.toString('hex'),
  }
}

export async function lockRun(client: PoolClient, runId: string): Promise<RunAuthority> {
  const authority = await loadRun(client, runId)
  await executeDatabaseQuery(
    queryDatabase(client)
      .select({ id: targets.id })
      .from(targets)
      .where(eq(targets.id, authority.plan.targetId))
      .for('update'),
  )
  const guardRows = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ active_run: executorGuards.activeRun })
      .from(executorGuards)
      .where(
        and(
          eq(executorGuards.targetId, authority.plan.targetId),
          eq(executorGuards.originalKey, authority.plan.originalSourceKey),
        ),
      )
      .for('update'),
  )
  const guard = guardRows[0]
  if (!guard) {
    throw new Error('source_guard_missing')
  }
  if (guard.active_run && guard.active_run !== runId) {
    throw new Error('source_reserved')
  }
  await executeDatabaseQuery(
    queryDatabase(client)
      .select({ id: executorRuns.id })
      .from(executorRuns)
      .where(eq(executorRuns.id, runId))
      .for('update'),
  )
  await loadRun(client, runId)
  return authority
}

export async function cancelRun(client: PoolClient, runId: string, actorId: string): Promise<void> {
  const authority = await lockRun(client, runId)
  if (authority.actorId !== actorId) {
    throw new Error('run_actor_mismatch')
  }
  await executeDatabaseQuery(
    queryDatabase(client).insert(executorCancels).values({ runId, actorId }),
  )
}

export async function selectRecovery(
  client: PoolClient,
  runId: string,
  operationKey: string,
  actorId: string,
): Promise<string> {
  const authority = await lockRun(client, runId)
  if (
    authority.actorId !== actorId ||
    !authority.plan.operations.some((value) => value.operationKey === operationKey)
  ) {
    throw new Error('recovery_scope_mismatch')
  }
  // Unknown sibling creates retain the SAME guard too; selecting another untouched
  // operation cannot be used to sneak additional creates past unresolved history.
  if ((await snapshot(client, runId)).state === 'recovery_required') {
    throw new Error('create_not_recoverable')
  }
  const intents = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ outcome: executorResults.outcome, certainty: executorEffects.certainty })
      .from(executorIntents)
      .leftJoin(executorResults, eq(executorResults.intentId, executorIntents.id))
      .leftJoin(executorEffects, eq(executorEffects.intentId, executorIntents.id))
      .where(
        and(
          eq(executorIntents.runId, runId),
          eq(executorIntents.operationKey, operationKey),
          eq(executorIntents.kind, 'create_stock'),
        ),
      ),
  )
  if (intents.some((row) => row.outcome !== 'proven_not_sent' || row.certainty !== 'none')) {
    throw new Error('create_not_recoverable')
  }
  const recoveryId = randomUUID()
  const cancelVersion = await cancellationVersion(client, runId)
  await executeDatabaseQuery(
    queryDatabase(client)
      .insert(executorRecoveries)
      .values({
        id: recoveryId,
        runId,
        operationKey,
        actorId,
        cancelVersion: BigInt(cancelVersion),
        kind: intents.length ? 'resume_no_effect' : 'resume_pending',
      }),
  )
  await executeDatabaseQuery(
    queryDatabase(client)
      .update(executorGuards)
      .set({ activeRun: runId })
      .where(
        and(
          eq(executorGuards.targetId, authority.plan.targetId),
          eq(executorGuards.originalKey, authority.plan.originalSourceKey),
        ),
      ),
  )
  return recoveryId
}

export interface StockSnapshot {
  runId: string
  state: 'queued' | 'settled_complete' | 'settled_incomplete' | 'recovery_required'
  confirmedStockIds: string[]
  attributedStockIds: string[]
  cancellationRequested: boolean
  attachments: AttachmentState[]
  operations: {
    operationKey: string
    certainty: 'confirmed' | 'unknown' | 'none'
    remotePk: string | null
  }[]
}

export async function snapshot(client: Pool | PoolClient, runId: string): Promise<StockSnapshot> {
  const authority = await loadRun(client, runId)
  if (isEffectsPlan(authority.plan)) {
    const states = await supportedStates(client, runId, authority.plan)
    const operations = states
      .filter((state) => state.kind === 'create_stock')
      .map((state) => ({
        operationKey: state.operationKey,
        certainty: state.certainty,
        remotePk: state.remotePks.length === 1 ? state.remotePks[0] : null,
      }))
    const attachments = await attachmentStates(client, runId, authority.plan, operations)
    const supportedRequests = await executeDatabaseQuery(
      queryDatabase(client)
        .select({ id: supportedIntents.id })
        .from(supportedIntents)
        .where(eq(supportedIntents.runId, runId))
        .limit(1),
    )
    const hasRequests = supportedRequests.length
    const cancelled = (
      await executeDatabaseQuery(
        queryDatabase(client)
          .select({ id: executorCancels.id })
          .from(executorCancels)
          .where(eq(executorCancels.runId, runId)),
      )
    ).length
    return {
      runId,
      cancellationRequested: Boolean(cancelled),
      attachments,
      operations,
      state: [...states, ...attachments].some((state) => state.certainty === 'unknown')
        ? 'recovery_required'
        : [...states, ...attachments].every((state) => state.certainty === 'confirmed')
          ? 'settled_complete'
          : hasRequests || cancelled
            ? 'settled_incomplete'
            : 'queued',
      confirmedStockIds: operations.flatMap((state) =>
        state.certainty === 'confirmed' && state.remotePk ? [state.remotePk] : [],
      ),
      attributedStockIds: states
        .filter((state) => state.kind === 'create_stock')
        .flatMap((state) => state.remotePks),
    }
  }
  const effects = await executeDatabaseQuery(
    queryDatabase(client)
      .select({
        operation_key: executorIntents.operationKey,
        certainty: executorEffects.certainty,
        remote_pk: executorEffects.remotePk,
      })
      .from(executorIntents)
      .leftJoin(executorEffects, eq(executorEffects.intentId, executorIntents.id))
      .where(and(eq(executorIntents.runId, runId), eq(executorIntents.kind, 'create_stock'))),
  )
  const operations = authority.plan.operations.map((operation) => {
    const rows = effects.filter((value) => value.operation_key === operation.operationKey)
    const confirmed = rows.find((value) => value.certainty === 'confirmed')
    const certainty: 'confirmed' | 'unknown' | 'none' = rows.some(
      (value) => !value.certainty || value.certainty === 'unknown',
    )
      ? 'unknown'
      : confirmed
        ? 'confirmed'
        : 'none'
    return {
      operationKey: operation.operationKey,
      certainty,
      remotePk: confirmed?.remote_pk ?? rows.find((value) => value.remote_pk)?.remote_pk ?? null,
    }
  })
  const attachments = await attachmentStates(client, runId, authority.plan, operations)
  const cancelled = (
    await executeDatabaseQuery(
      queryDatabase(client)
        .select({ id: executorCancels.id })
        .from(executorCancels)
        .where(eq(executorCancels.runId, runId)),
    )
  ).length
  const hasRequests = (
    await executeDatabaseQuery(
      queryDatabase(client)
        .select({ id: executorIntents.id })
        .from(executorIntents)
        .where(eq(executorIntents.runId, runId))
        .limit(1),
    )
  ).length
  return {
    runId,
    cancellationRequested: Boolean(cancelled),
    attachments,
    state: [...operations, ...attachments].some((value) => value.certainty === 'unknown')
      ? 'recovery_required'
      : [...operations, ...attachments].every((value) => value.certainty === 'confirmed')
        ? 'settled_complete'
        : cancelled || hasRequests
          ? 'settled_incomplete'
          : 'queued',
    confirmedStockIds: operations.flatMap((value) =>
      value.certainty === 'confirmed' && value.remotePk ? [value.remotePk] : [],
    ),
    attributedStockIds: operations.flatMap((value) => (value.remotePk ? [value.remotePk] : [])),
    operations,
  }
}
