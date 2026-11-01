import { randomUUID } from 'node:crypto'
import type { PoolClient, Pool } from 'pg'
import { canonical } from '@invimport/contracts/json'
import { sha256, verifyBytes } from '../db/authority.ts'
import { decodePlan, stockBytes, type StockPlan, id } from './plan.ts'

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
  plan: StockPlan
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
  await client.query('INSERT INTO executor_source VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [
    input.targetId,
    input.sourceId,
    input.originalSourceKey,
  ])
  const stored = (
    await client.query(
      'SELECT original_key FROM executor_source WHERE target_id=$1 AND source_id=$2',
      [input.targetId, input.sourceId],
    )
  ).rows[0]
  if (!stored || stored.original_key !== input.originalSourceKey)
    throw new Error('original_source_binding_conflict')
}
export async function checkDeployment(client: Pick<PoolClient, 'query'>, plan: StockPlan) {
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
  )
    throw new Error('deployment_binding_mismatch')
  return row as { origin: string; epoch: string; id: string }
}
/** T04 calls inside its approval transaction AFTER current draft/review/actor checks.
 * This seam does not itself approve a draft, register a source, or commit the transaction.
 */
export async function reserveApprovedStock(
  client: PoolClient,
  input: Reservation,
): Promise<{ runId: string; commandId: string; approvalId: string }> {
  for (const key of ['approvalId', 'preparationId', 'runId', 'commandId', 'actorId'] as const)
    id(input[key])
  const plan = decodePlan(input.bytes, input.digest)
  await client.query('SELECT id FROM target WHERE id=$1 FOR UPDATE', [plan.targetId])
  await checkDeployment(client, plan)
  const source = await client.query(
    'SELECT 1 FROM executor_source WHERE target_id=$1 AND source_id=$2 AND original_key=$3',
    [plan.targetId, plan.sourceId, plan.originalSourceKey],
  )
  if (!source.rowCount) throw new Error('original_source_authority_missing')
  await client.query(
    'INSERT INTO executor_guard(target_id,original_key) VALUES ($1,$2) ON CONFLICT DO NOTHING',
    [plan.targetId, plan.originalSourceKey],
  )
  const guard = (
    await client.query(
      'SELECT active_run FROM executor_guard WHERE target_id=$1 AND original_key=$2 FOR UPDATE',
      [plan.targetId, plan.originalSourceKey],
    )
  ).rows[0]
  const prior = await client.query(
    `SELECT a.*,r.id AS run_id,r.command_id FROM executor_approval a JOIN executor_run r ON r.approval_id=a.id WHERE a.preparation_id=$1`,
    [input.preparationId],
  )
  if (prior.rowCount) {
    const row = prior.rows[0]
    verifyBytes(row.plan_bytes, row.plan_digest)
    if (row.actor_id !== input.actorId || !row.plan_bytes.equals(input.bytes))
      throw new Error('approval_payload_conflict')
    await loadRun(client, row.run_id)
    return { runId: row.run_id, commandId: row.command_id, approvalId: row.id }
  }
  if (guard.active_run) throw new Error('source_reserved')
  // Never infer a clean source merely from its current guard pointer.
  const previousRuns = await client.query(
    'SELECT id FROM executor_run WHERE target_id=$1 AND original_key=$2',
    [plan.targetId, plan.originalSourceKey],
  )
  for (const previous of previousRuns.rows) {
    const state = (await snapshot(client, previous.id)).state
    if (state === 'recovery_required' || state === 'queued')
      throw new Error('source_history_unsettled')
  }
  // A previous approved contribution blocks even when its stock no longer exists.
  const history = await client.query(
    'SELECT contribution_key FROM executor_operation WHERE target_id=$1 AND contribution_key=ANY($2::uuid[])',
    [plan.targetId, plan.operations.map((value) => value.contributionKey)],
  )
  if (history.rowCount) throw new Error('original_contribution_already_approved')
  await client.query('INSERT INTO executor_approval VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [
    input.approvalId,
    input.preparationId,
    input.actorId,
    plan.deploymentId,
    plan.targetId,
    plan.contextId,
    plan.sourceId,
    plan.originalSourceKey,
    input.bytes,
    input.digest,
  ])
  const payload = Buffer.from(
    canonical({
      runId: input.runId,
      approvalId: input.approvalId,
      planDigest: input.digest.toString('hex'),
    }),
  )
  await client.query(
    `INSERT INTO command(id,actor_id,target_id,target_context_id,kind,handler_version,workflow_id,queue_name,payload_bytes,payload_digest) VALUES ($1,$2,$3,$4,'apply',$5,$6,'bench-apply',$7,$8)`,
    [
      input.commandId,
      input.actorId,
      plan.targetId,
      plan.contextId,
      plan.build,
      `stock:${input.runId}`,
      payload,
      sha256(payload),
    ],
  )
  await client.query('INSERT INTO outbox(command_id) VALUES ($1)', [input.commandId])
  await client.query('INSERT INTO executor_run VALUES ($1,$2,$3,$4,$5)', [
    input.runId,
    input.approvalId,
    input.commandId,
    plan.targetId,
    plan.originalSourceKey,
  ])
  for (const operation of plan.operations) {
    const bytes = stockBytes(operation)
    await client.query('INSERT INTO executor_operation VALUES ($1,$2,$3,$4,$5,$6,$7)', [
      input.runId,
      operation.operationKey,
      plan.targetId,
      plan.originalSourceKey,
      operation.contributionKey,
      bytes,
      sha256(bytes),
    ])
  }
  await client.query(
    'UPDATE executor_guard SET active_run=$3 WHERE target_id=$1 AND original_key=$2',
    [plan.targetId, plan.originalSourceKey, input.runId],
  )
  return { runId: input.runId, commandId: input.commandId, approvalId: input.approvalId }
}
/** Every start/adopt and authorization rechecks ALL retained bindings, not just a run status. */
export async function loadRun(
  client: Pick<PoolClient, 'query'>,
  runId: string,
): Promise<RunAuthority> {
  id(runId)
  const result = await client.query(
    `SELECT a.*,r.command_id,c.payload_bytes,c.payload_digest,c.handler_version,c.actor_id AS command_actor,c.target_id AS command_target,c.target_context_id,c.kind,c.workflow_id,c.queue_name
    FROM executor_run r JOIN executor_approval a ON a.id=r.approval_id JOIN command c ON c.id=r.command_id WHERE r.id=$1`,
    [runId],
  )
  const row = result.rows[0]
  if (!row) throw new Error('run_authority_missing')
  const plan = decodePlan(row.plan_bytes, row.plan_digest)
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
  )
    throw new Error('command_authority_mismatch')
  const operations = (
    await client.query('SELECT * FROM executor_operation WHERE run_id=$1', [runId])
  ).rows
  if (operations.length !== plan.operations.length) throw new Error('operation_authority_missing')
  for (const operation of plan.operations) {
    const stored = operations.find((value) => value.operation_key === operation.operationKey)
    if (
      !stored ||
      stored.contribution_key !== operation.contributionKey ||
      stored.original_key !== plan.originalSourceKey ||
      stored.target_id !== plan.targetId
    )
      throw new Error('operation_binding_mismatch')
    verifyBytes(stored.request_bytes, stored.request_digest)
    if (!stored.request_bytes.equals(stockBytes(operation)))
      throw new Error('operation_bytes_mismatch')
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
  await client.query('SELECT id FROM target WHERE id=$1 FOR UPDATE', [authority.plan.targetId])
  const guard = (
    await client.query(
      'SELECT active_run FROM executor_guard WHERE target_id=$1 AND original_key=$2 FOR UPDATE',
      [authority.plan.targetId, authority.plan.originalSourceKey],
    )
  ).rows[0]
  if (!guard) throw new Error('source_guard_missing')
  if (guard.active_run && guard.active_run !== runId) throw new Error('source_reserved')
  await client.query('SELECT id FROM executor_run WHERE id=$1 FOR UPDATE', [runId])
  await loadRun(client, runId)
  return authority
}
export async function cancelRun(client: PoolClient, runId: string, actorId: string): Promise<void> {
  const authority = await lockRun(client, runId)
  if (authority.actorId !== actorId) throw new Error('run_actor_mismatch')
  await client.query('INSERT INTO executor_cancel(run_id,actor_id) VALUES ($1,$2)', [
    runId,
    actorId,
  ])
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
  )
    throw new Error('recovery_scope_mismatch')
  // Unknown sibling creates retain the SAME guard too; selecting another untouched
  // operation cannot be used to sneak additional creates past unresolved history.
  if ((await snapshot(client, runId)).state === 'recovery_required')
    throw new Error('create_not_recoverable')
  const intents = await client.query(
    `SELECT i.*,r.outcome,e.certainty FROM executor_intent i LEFT JOIN executor_result r ON r.intent_id=i.id LEFT JOIN executor_effect e ON e.intent_id=i.id WHERE i.run_id=$1 AND i.operation_key=$2 AND i.kind='create_stock'`,
    [runId, operationKey],
  )
  if (intents.rows.some((row) => row.outcome !== 'proven_not_sent' || row.certainty !== 'none'))
    throw new Error('create_not_recoverable')
  const recoveryId = randomUUID()
  const cancelVersion = (
    await client.query(
      'SELECT COALESCE(max(id),0) AS version FROM executor_cancel WHERE run_id=$1',
      [runId],
    )
  ).rows[0].version
  await client.query('INSERT INTO executor_recovery VALUES ($1,$2,$3,$4,$5,$6)', [
    recoveryId,
    runId,
    operationKey,
    actorId,
    cancelVersion,
    intents.rowCount ? 'resume_no_effect' : 'resume_pending',
  ])
  await client.query(
    'UPDATE executor_guard SET active_run=$3 WHERE target_id=$1 AND original_key=$2',
    [authority.plan.targetId, authority.plan.originalSourceKey, runId],
  )
  return recoveryId
}
export interface StockSnapshot {
  runId: string
  state: 'queued' | 'settled_complete' | 'settled_incomplete' | 'recovery_required'
  confirmedStockIds: string[]
  attributedStockIds: string[]
  cancellationRequested: boolean
  operations: {
    operationKey: string
    certainty: 'confirmed' | 'unknown' | 'none'
    remotePk: string | null
  }[]
}
export async function snapshot(
  client: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>,
  runId: string,
): Promise<StockSnapshot> {
  const authority = await loadRun(client, runId)
  const effects = (
    await client.query(
      `SELECT i.operation_key,e.certainty,e.remote_pk FROM executor_intent i LEFT JOIN executor_effect e ON e.intent_id=i.id WHERE i.run_id=$1 AND i.kind='create_stock'`,
      [runId],
    )
  ).rows
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
  const cancelled = (await client.query('SELECT 1 FROM executor_cancel WHERE run_id=$1', [runId]))
    .rowCount
  const hasRequests = (
    await client.query('SELECT 1 FROM executor_intent WHERE run_id=$1 LIMIT 1', [runId])
  ).rowCount
  return {
    runId,
    cancellationRequested: Boolean(cancelled),
    state: operations.some((value) => value.certainty === 'unknown')
      ? 'recovery_required'
      : operations.every((value) => value.certainty === 'confirmed')
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
