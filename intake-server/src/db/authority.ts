import { createHash, timingSafeEqual } from 'node:crypto'
import type { PoolClient } from 'pg'
import { canonical } from '@invimport/contracts/json'

export const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest()
export function verifyBytes(bytes: Buffer, expected: Buffer): void {
  if (expected.length !== 32 || !timingSafeEqual(sha256(bytes), expected)) throw new Error('retained_bytes_corrupt')
}
export interface CommandScope { actorId: string; action: string; resourceKey: string; key: string }
/** Caller owns the domain transaction. No network effects or automatic retries are permitted here. */
export async function idempotent(client: PoolClient, scope: CommandScope, payload: unknown, work: () => Promise<unknown>): Promise<unknown> {
  const values = [scope.actorId, scope.action, scope.resourceKey, scope.key]
  // Lock the exact logical scope before looking for a row; unlike row locking this covers absent keys.
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [canonical(values)])
  const bytes = Buffer.from(canonical(payload))
  const found = await client.query<{ semantic_bytes: Buffer; semantic_digest: Buffer; response_bytes: Buffer }>('SELECT semantic_bytes,semantic_digest,response_bytes FROM idempotency_record WHERE actor_id=$1 AND action=$2 AND resource_key=$3 AND key=$4', values)
  if (found.rowCount) {
    const prior = found.rows[0]
    verifyBytes(prior.semantic_bytes, prior.semantic_digest)
    if (!prior.semantic_bytes.equals(bytes)) throw new Error('payload_conflict')
    return JSON.parse(prior.response_bytes.toString('utf8')) as unknown
  }
  const result = await work()
  const response = Buffer.from(canonical(result))
  await client.query('INSERT INTO idempotency_record VALUES ($1,$2,$3,$4,$5,$6,$7)', [...values, bytes, sha256(bytes), response])
  return result
}
/** Acquire stream heads LAST, sorted by id for multi-stream transactions; holds until COMMIT. */
export async function appendEvent(client: PoolClient, streamId: string, kind: string, payload: unknown): Promise<string> {
  const result = await client.query<{ head: string }>('UPDATE ui_stream SET head=head+1 WHERE id=$1 RETURNING head', [streamId])
  if (result.rowCount !== 1) throw new Error('stream_missing')
  const sequence = result.rows[0].head
  await client.query('INSERT INTO ui_event VALUES ($1,$2,$3,$4)', [streamId, sequence, kind, Buffer.from(canonical(payload))])
  return sequence
}
