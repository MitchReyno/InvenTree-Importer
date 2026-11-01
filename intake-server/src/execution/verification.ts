import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { canonical } from '@invimport/contracts/json'
import { sha256 } from '../db/authority.ts'
import { inventoryTransport, type TargetProfile } from '../inventory/transport.ts'
import { executorTransaction } from './transaction.ts'
import { checkDeployment, lockRun } from './authority.ts'
import { inventoryBody, responseObject, responsePk, stockMatches } from './response.ts'

interface CreateAttempt {
  intent_id: string
  attempt: number
  certainty: string | null
  remote_pk: string | null
  outcome: string | null
  status: number | null
  response_bytes: Buffer | null
}

/** Explicit selected ORIGINAL confirmed-output read. No writable closure, barcode search,
 * guessed attribution, unknown-create adoption or replacement/replenishment permission.
 * T04 owns user/object authorization before invoking this server-internal seam.
 */
export async function verifyKnownStock(pool: Pool, profile: TargetProfile, input: { runId: string; operationKey: string; actorId: string }) {
  const intentId = randomUUID()
  const retained = await executorTransaction(pool,async client => {
    const authority = await lockRun(client,input.runId)
    if (input.actorId !== authority.actorId) throw new Error('verification_actor_mismatch')
    const operation = authority.plan.operations.find(value => value.operationKey === input.operationKey)
    const deployment = await checkDeployment(client,authority.plan)
    if (!operation || deployment.origin !== profile.origin || profile.targetId !== authority.plan.targetId || profile.contextId !== authority.plan.contextId) throw new Error('verification_binding_mismatch')
    // Start at intents: an unresolved attempt must not disappear through an inner join.
    const attempts = (await client.query<CreateAttempt>(`
      SELECT i.id AS intent_id,i.attempt,e.certainty,e.remote_pk,r.outcome,r.status,r.response_bytes
      FROM executor_intent i
      LEFT JOIN executor_effect e ON e.intent_id=i.id
      LEFT JOIN executor_result r ON r.intent_id=i.id
      WHERE i.run_id=$1 AND i.operation_key=$2 AND i.kind='create_stock'
    `,[input.runId,input.operationKey])).rows
    const confirmed = attempts.filter(value => value.certainty === 'confirmed')
    if (confirmed.length !== 1) throw new Error('known_output_required')
    const effect = confirmed[0]
    if (!effect.remote_pk || effect.outcome !== 'response' || effect.status !== 201) throw new Error('known_output_required')
    // Selected recovery may follow positively checkpointed local refusals only.
    // Any other create history remains ambiguous or conflicting, never verification authority.
    const earlierNoEffects = attempts.filter(value => value.intent_id !== effect.intent_id).every(value =>
      value.attempt < effect.attempt && value.outcome === 'proven_not_sent' &&
      value.certainty === 'none' && value.remote_pk === null &&
      value.status === null && value.response_bytes === null)
    if (!earlierNoEffects) throw new Error('known_output_required')
    const bytes = Buffer.from(canonical({ kind: 'get_stock',pk: effect.remote_pk }))
    const attempt = (await client.query("SELECT count(*)::int+1 AS next FROM executor_intent WHERE run_id=$1 AND operation_key=$2 AND kind='get_stock'",[input.runId,input.operationKey])).rows[0].next
    await client.query(`INSERT INTO executor_intent(id,run_id,operation_key,attempt,kind,request_bytes,request_digest) VALUES ($1,$2,$3,$4,'get_stock',$5,$6)`,[intentId,input.runId,input.operationKey,attempt,bytes,sha256(bytes)])
    return { authority,operation,effect: { intent_id: effect.intent_id,remote_pk: effect.remote_pk } }
  })
  // Even if caller supplied a writable profile, this verifier retains ONLY the read closure.
  const { read } = inventoryTransport({ ...profile,kind: 'protected-read-only' })
  let bytes: Buffer | null = null, status: number | null = null
  let outcome: 'matches' | 'missing_or_changed' | 'unavailable' = 'unavailable'
  try {
    const response = await read(retained.authority.plan,{ kind: 'get_stock',pk: retained.effect.remote_pk })
    status = response.status; bytes = await inventoryBody(response)
  } catch { bytes = null; status = null }
  try {
    if (status === 404) outcome = 'missing_or_changed'
    else if (status === 200 && bytes) {
      const value = responseObject(bytes)
      outcome = responsePk(value.pk) === retained.effect.remote_pk && stockMatches(value,retained.operation) ? 'matches' : 'missing_or_changed'
    }
  } catch { /* Keep the actual malformed response as evidence, not a fake transport loss. */ }
  await executorTransaction(pool,async client => {
    await lockRun(client,input.runId)
    await client.query('INSERT INTO executor_result(intent_id,outcome,status,response_bytes) VALUES ($1,$2,$3,$4)',[intentId,status === null ? 'transport_loss' : 'response',status,bytes])
    await client.query('INSERT INTO executor_verification VALUES ($1,$2,$3,$4,$5)',[intentId,retained.effect.intent_id,input.runId,input.operationKey,outcome])
  })
  return { intentId,remotePk: retained.effect.remote_pk,outcome }
}
