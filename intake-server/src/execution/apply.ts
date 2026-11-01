import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
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
    await pool.query('SELECT origin FROM executor_deployment WHERE id=$1', [
      authority.plan.deploymentId,
    ])
  ).rows[0]
  if (
    profile.origin !== deployment.origin ||
    profile.targetId !== authority.plan.targetId ||
    profile.contextId !== authority.plan.contextId ||
    profile.kind !== 'owned-disposable'
  )
    throw new Error('apply_profile_mismatch')
  const transport = inventoryTransport(profile)
  async function health() {
    if (deps.stopped()) throw new Error('apply_stopping')
    await gate.requireClaim(claimToken)
    await writer.check()
    await gate.check(pool, authority.plan)
  }
  await health()
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
      if ((await snapshot(client, runId)).state === 'recovery_required') return false
      const guard = (
        await client.query(
          'SELECT active_run FROM executor_guard WHERE target_id=$1 AND original_key=$2',
          [authority.plan.targetId, authority.plan.originalSourceKey],
        )
      ).rows[0]
      if (guard.active_run !== runId) throw new Error('source_not_owned')
      const cancelVersion = (
        await client.query(
          'SELECT COALESCE(max(id),0) AS version FROM executor_cancel WHERE run_id=$1',
          [runId],
        )
      ).rows[0].version
      if (cancelVersion !== '0' && !recoveryId) return false
      if (recoveryId) {
        const selected = await client.query(
          'SELECT cancel_version FROM executor_recovery WHERE id=$1 AND run_id=$2 AND operation_key=$3',
          [recoveryId, runId, operation.operationKey],
        )
        if (!selected.rowCount) throw new Error('recovery_authority_missing')
        if (selected.rows[0].cancel_version !== cancelVersion) return false
      }
      const attempts = (
        await client.query(
          `SELECT i.*,e.certainty,r.outcome FROM executor_intent i LEFT JOIN executor_effect e ON e.intent_id=i.id LEFT JOIN executor_result r ON r.intent_id=i.id WHERE i.run_id=$1 AND i.operation_key=$2 AND i.kind=$3 ORDER BY i.attempt`,
          [runId, operation.operationKey, kind],
        )
      ).rows
      if (
        attempts.length &&
        (!recoveryId || attempts.some((row) => row.recovery_id === recoveryId))
      )
        throw new Error('selected_recovery_required')
      if (
        kind === 'create_stock' &&
        attempts.some((row) => row.certainty !== 'none' || row.outcome !== 'proven_not_sent')
      )
        throw new Error('create_not_recoverable')
      await client.query(
        'INSERT INTO executor_intent(id,run_id,operation_key,attempt,recovery_id,kind,request_bytes,request_digest) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          intentId,
          runId,
          operation.operationKey,
          attempts.length + 1,
          recoveryId,
          kind,
          bytes,
          sha256(bytes),
        ],
      )
      return true
    })
    if (!authorized) return null
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
        await pool.query('SELECT plan_digest FROM executor_approval WHERE id=$1', [
          authority.approvalId,
        ])
      ).rows[0]
      await gate.witness(intentId, row.plan_digest, sha256(bytes), authority.plan.deploymentId)
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
        if (received.status === 201 && stockMatches(value, operation)) certainty = 'confirmed'
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
      await client.query(
        'INSERT INTO executor_result(intent_id,outcome,status,response_bytes) VALUES ($1,$2,$3,$4)',
        [intentId, outcome, status, bytes],
      )
      if (kind === 'create_stock')
        await client.query('INSERT INTO executor_effect VALUES ($1,$2,$3,$4,$5)', [
          intentId,
          runId,
          operation.operationKey,
          certainty,
          remotePk,
        ])
    })
    await deps.checkpoint?.('result_committed', kind, intentId)
  }
  const selected = (
    await pool.query('SELECT * FROM executor_recovery WHERE id=ANY($1::uuid[])', [recoveryIds])
  ).rows
  if (selected.length !== recoveryIds.length || selected.some((row) => row.run_id !== runId))
    throw new Error('recovery_scope_mismatch')
  for (const operation of authority.plan.operations) {
    const recovery = selected.find((row) => row.operation_key === operation.operationKey)
    if (recoveryIds.length && !recovery) continue
    const current = (await snapshot(pool, runId)).operations.find(
      (row) => row.operationKey === operation.operationKey,
    )!
    if (current.certainty === 'confirmed') continue
    if (current.certainty === 'unknown') break
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
    if (!preconditions) break
    await request(operation, 'create_stock', stockBytes(operation), recovery?.id ?? null, () =>
      transport.sendStock(authority.plan, stockBytes(operation).toString('utf8')),
    )
    if ((await snapshot(pool, runId)).operations.some((row) => row.certainty === 'unknown')) break
  }
  return settle(pool, authority)
}
async function settle(pool: Pool, authority: RunAuthority) {
  return transaction(pool, async (client) => {
    await lockRun(client, authority.runId)
    const result = await snapshot(client, authority.runId)
    // A safe partial run may release for NEW contributions; prior operations stay pinned.
    if (result.state === 'settled_complete' || result.state === 'settled_incomplete')
      await client.query(
        'UPDATE executor_guard SET active_run=NULL WHERE target_id=$1 AND original_key=$2 AND active_run=$3',
        [authority.plan.targetId, authority.plan.originalSourceKey, authority.runId],
      )
    return result
  })
}
