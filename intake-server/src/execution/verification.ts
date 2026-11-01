import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { canonical } from '@invimport/contracts/json'
import { sha256 } from '../db/authority.ts'
import { inventoryTransport, type TargetProfile } from '../inventory/transport.ts'
import { executorTransaction } from './transaction.ts'
import { checkDeployment, lockRun } from './authority.ts'
import { inventoryBody, responseObject, responsePk, stockMatches } from './response.ts'

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
    const effects = (await client.query(`SELECT e.* FROM executor_effect e JOIN executor_intent i ON i.id=e.intent_id WHERE i.run_id=$1 AND i.operation_key=$2 AND i.kind='create_stock'`,[input.runId,input.operationKey])).rows
    if (effects.length !== 1 || effects[0].certainty !== 'confirmed') throw new Error('known_output_required')
    const effect = effects[0]
    const bytes = Buffer.from(canonical({ kind: 'get_stock',pk: effect.remote_pk }))
    const attempt = (await client.query("SELECT count(*)::int+1 AS next FROM executor_intent WHERE run_id=$1 AND operation_key=$2 AND kind='get_stock'",[input.runId,input.operationKey])).rows[0].next
    await client.query(`INSERT INTO executor_intent(id,run_id,operation_key,attempt,kind,request_bytes,request_digest) VALUES ($1,$2,$3,$4,'get_stock',$5,$6)`,[intentId,input.runId,input.operationKey,attempt,bytes,sha256(bytes)])
    return { authority,operation,effect }
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
  return { intentId,remotePk: retained.effect.remote_pk as string,outcome }
}
