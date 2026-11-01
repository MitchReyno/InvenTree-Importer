import { createHash, timingSafeEqual } from 'node:crypto'
import type { PoolClient } from 'pg'
import { and, eq } from 'drizzle-orm'
import { canonical } from '@invimport/contracts/json'
import { executeDatabaseQuery, queryDatabase } from './database.ts'
import { events, idempotencyRecords } from './schema.ts'

const SHA256_BYTES = 32

export const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest()

export function verifyBytes(bytes: Buffer, expected: Buffer): void {
  if (expected.length !== SHA256_BYTES || !timingSafeEqual(sha256(bytes), expected)) {
    throw new Error('retained_bytes_corrupt')
  }
}

/** A reused command key cannot authorize a different semantic payload. */
export class CommandPayloadConflict extends Error {
  constructor() {
    super('payload_conflict')
    this.name = 'CommandPayloadConflict'
  }
}

export interface CommandScope {
  actorId: string
  action: string
  resourceKey: string
  key: string
}

async function lockCommandScope(client: PoolClient, scope: CommandScope): Promise<void> {
  const identity = [scope.actorId, scope.action, scope.resourceKey, scope.key]
  // Unlike a row lock, this serializes the exact logical scope even when the key is absent.
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [canonical(identity)])
}

async function findIdempotencyRecord(client: PoolClient, scope: CommandScope) {
  const records = await executeDatabaseQuery(
    queryDatabase(client)
      .select({
        semanticBytes: idempotencyRecords.semanticBytes,
        semanticDigest: idempotencyRecords.semanticDigest,
        responseBytes: idempotencyRecords.responseBytes,
      })
      .from(idempotencyRecords)
      .where(
        and(
          eq(idempotencyRecords.actorId, scope.actorId),
          eq(idempotencyRecords.action, scope.action),
          eq(idempotencyRecords.resourceKey, scope.resourceKey),
          eq(idempotencyRecords.key, scope.key),
        ),
      ),
  )
  return records[0]
}

async function retainIdempotencyRecord(
  client: PoolClient,
  scope: CommandScope,
  semanticBytes: Buffer,
  result: unknown,
): Promise<void> {
  await executeDatabaseQuery(
    queryDatabase(client)
      .insert(idempotencyRecords)
      .values({
        ...scope,
        semanticBytes,
        semanticDigest: sha256(semanticBytes),
        responseBytes: Buffer.from(canonical(result)),
      }),
  )
}

/** Caller owns the domain transaction. No network effects or automatic retries are permitted here. */
export async function idempotent(
  client: PoolClient,
  scope: CommandScope,
  payload: unknown,
  work: () => Promise<unknown>,
): Promise<unknown> {
  const commandScope = { ...scope }
  await lockCommandScope(client, commandScope)
  const bytes = Buffer.from(canonical(payload))
  const prior = await findIdempotencyRecord(client, commandScope)
  if (prior) {
    verifyBytes(prior.semanticBytes, prior.semanticDigest)
    if (!prior.semanticBytes.equals(bytes)) {
      throw new CommandPayloadConflict()
    }
    return JSON.parse(prior.responseBytes.toString('utf8')) as unknown
  }

  const result = await work()
  await retainIdempotencyRecord(client, commandScope, bytes, result)
  return result
}

/** Acquire stream heads LAST, sorted by id for multi-stream transactions; holds until COMMIT. */
export async function appendEvent(
  client: PoolClient,
  streamId: string,
  kind: string,
  payload: unknown,
): Promise<string> {
  const result = await client.query<{ head: string }>(
    `UPDATE ui_stream
     SET head = head + 1
     WHERE id = $1
     RETURNING head`,
    [streamId],
  )
  if (result.rowCount !== 1) {
    throw new Error('stream_missing')
  }
  const sequence = result.rows[0].head
  await executeDatabaseQuery(
    queryDatabase(client)
      .insert(events)
      .values({
        streamId,
        sequence: BigInt(sequence),
        kind,
        publicBytes: Buffer.from(canonical(payload)),
      }),
  )
  return sequence
}
