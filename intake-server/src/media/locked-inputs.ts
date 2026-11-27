import { createHash, randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { sql } from 'drizzle-orm'
import { executeDatabaseQuery, queryDatabase } from '#/db/database.ts'
import { Id } from '@invimport/contracts'
import { canonicalMedia } from './encoding.ts'
import { blobLockCoordinates, lockBlob } from './blob-store.ts'
import {
  resolveBatchMediaInputs,
  resolveMediaInputScopes,
  decodeMediaInputs,
  type MediaInputVersion,
  type MediaInputs,
  type MediaSubjectScope,
} from './inputs.ts'
import type { CaptureBinding } from '#/capture/model.ts'
import { mediaPinSet } from './command-inputs.ts'

const lockedHandle = Symbol('locked-media-inputs')

export interface LockedMediaInputs {
  readonly [lockedHandle]: true
  readonly manifest: string
  readonly manifestDigest: string
  readonly versions: readonly Readonly<MediaInputVersion>[]
  pinCommand: (commandId: string) => Promise<void>
}

interface TransactionIdentity {
  transaction_id: string
  backend_pid: number
}

async function transactionIdentity(client: PoolClient): Promise<TransactionIdentity> {
  const result = await client.query<TransactionIdentity>(
    `SELECT pg_catalog.pg_current_xact_id()::text AS transaction_id,
            pg_catalog.pg_backend_pid() AS backend_pid`,
  )
  return result.rows[0]
}

function sameTransaction(left: TransactionIdentity, right: TransactionIdentity) {
  return left.backend_pid === right.backend_pid && left.transaction_id === right.transaction_id
}

async function requireHeldDigests(client: PoolClient, inputs: MediaInputs) {
  const coordinates = new Map<string, { classId: string; objectId: string }>()
  for (const version of inputs.versions) {
    const coordinate = blobLockCoordinates(version.digest)
    coordinates.set(`${coordinate.classId}:${coordinate.objectId}`, coordinate)
  }
  const expected = [...coordinates.values()]
  const result = await client.query<{ held: string }>(
    `SELECT count(*)::text AS held
     FROM unnest($1::oid[],$2::oid[]) expected(class_id,object_id)
     JOIN pg_catalog.pg_locks held ON held.locktype='advisory'
       AND held.pid=pg_catalog.pg_backend_pid() AND held.granted
       AND held.classid=expected.class_id AND held.objid=expected.object_id AND held.objsubid=1`,
    [
      expected.map((coordinate) => coordinate.classId),
      expected.map((coordinate) => coordinate.objectId),
    ],
  )
  if (BigInt(result.rows[0].held) !== BigInt(expected.length)) {
    throw new Error('media_input_lock_lost')
  }
}

/** A per-handle transaction lock is released by rollback before acquisition, including empty scopes. */
async function retainHandleLifetime(client: PoolClient) {
  const key = createHash('sha256')
    .update(`bench-media-input-handle/1:${randomUUID()}`)
    .digest()
    .readBigInt64BE()
  await executeDatabaseQuery(
    queryDatabase(client).execute(
      sql`SELECT pg_catalog.pg_advisory_xact_lock(${key.toString()}::bigint)`,
    ),
  )
  const unsignedKey = BigInt.asUintN(64, key)
  return {
    classId: (unsignedKey >> 32n).toString(),
    objectId: (unsignedKey & 0xffffffffn).toString(),
  }
}

async function requireHandleLifetime(
  client: PoolClient,
  coordinate: { classId: string; objectId: string },
) {
  const held = await client.query(
    `SELECT 1 FROM pg_catalog.pg_locks
     WHERE locktype='advisory' AND pid=pg_catalog.pg_backend_pid() AND granted
       AND classid=$1::oid AND objid=$2::oid AND objsubid=1`,
    [coordinate.classId, coordinate.objectId],
  )
  if (held.rowCount !== 1) {
    throw new Error('media_input_lock_lost')
  }
}

async function pinCapturedCommand(
  client: PoolClient,
  binding: CaptureBinding,
  commandId: string,
  inputs: MediaInputs,
) {
  if (!new RegExp(Id.pattern!).test(commandId)) {
    throw new Error('invalid_media_command_id')
  }
  // This is a later command lock, never a new digest/batch/lane lock.
  await executeDatabaseQuery(
    queryDatabase(client).execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended('bench-media-command-pin/1:' || ${commandId},0))`,
    ),
  )
  const command = await client.query(
    `SELECT 1 FROM public.command WHERE id=$1 AND actor_id=$2 AND target_id=$3 AND target_context_id=$4`,
    [commandId, binding.actorId, binding.targetId, binding.targetContextId],
  )
  if (!command.rowCount) {
    throw new Error('media_pin_owner_binding_invalid')
  }
  const existingBinding = await client.query<{ manifest_bytes: Buffer; manifest_digest: Buffer }>(
    'SELECT manifest_bytes,manifest_digest FROM public.media_command_binding WHERE command_id=$1',
    [commandId],
  )
  const original = existingBinding.rows[0]
  if (original) {
    const retained = decodeMediaInputs(original.manifest_bytes, original.manifest_digest)
    if (!retained.bytes.equals(inputs.bytes)) {
      throw new Error('media_command_pin_scope_changed')
    }
  } else {
    await client.query(
      `INSERT INTO public.media_command_binding(command_id,batch_id,actor_id,target_id,target_context_id,manifest_bytes,manifest_digest)
       VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [
        commandId,
        inputs.batchId,
        binding.actorId,
        binding.targetId,
        binding.targetContextId,
        inputs.bytes,
        inputs.digest,
      ],
    )
  }
  const existing = await client.query<{
    version_id: string
    blob_digest: string
    batch_id: string
  }>(
    `SELECT version_id,encode(blob_digest,'hex') AS blob_digest,batch_id FROM public.media_command_pin
     WHERE command_id=$1 ORDER BY version_id`,
    [commandId],
  )
  if (original) {
    if (canonicalMedia(existing.rows) !== canonicalMedia(mediaPinSet(inputs))) {
      throw new Error('media_command_pin_scope_changed')
    }
    return
  }
  for (const version of inputs.versions) {
    await client.query(
      `INSERT INTO public.media_command_pin(command_id,batch_id,version_id,blob_digest)
       VALUES($1,$2,$3,$4)`,
      [commandId, inputs.batchId, version.versionId, Buffer.from(version.digest, 'hex')],
    )
  }
}

function freezeDescriptor(value: unknown): void {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) {
      freezeDescriptor(child)
    }
    Object.freeze(value)
  }
}

async function capturedHandle(
  client: PoolClient,
  retainedBinding: CaptureBinding,
  identity: TransactionIdentity,
  captured: MediaInputs,
): Promise<LockedMediaInputs> {
  const lifetime = await retainHandleLifetime(client)
  // Exposed descriptors are copies; mutation cannot change the private captured pin set.
  const descriptors = structuredClone(captured.versions)
  for (const descriptor of descriptors) {
    freezeDescriptor(descriptor)
  }
  return Object.freeze({
    [lockedHandle]: true as const,
    manifest: captured.bytes.toString('utf8'),
    manifestDigest: captured.digest.toString('hex'),
    versions: Object.freeze(descriptors),
    async pinCommand(commandId: string) {
      if (!sameTransaction(identity, await transactionIdentity(client))) {
        throw new Error('media_input_transaction_changed')
      }
      await requireHandleLifetime(client, lifetime)
      await requireHeldDigests(client, captured)
      await pinCapturedCommand(client, retainedBinding, commandId, captured)
    },
  })
}

/** Call before job/question locks; all digests are held before any per-scope capability is returned. */
export async function lockMediaInputScopes(
  client: PoolClient,
  binding: CaptureBinding,
  batchId: string,
  subjectScopes: readonly MediaSubjectScope[],
): Promise<readonly LockedMediaInputs[]> {
  const retainedBinding = Object.freeze({ ...binding })
  const identity = await transactionIdentity(client)
  if (!sameTransaction(identity, await transactionIdentity(client))) {
    throw new Error('media_inputs_require_transaction')
  }
  const resolved = await resolveMediaInputScopes(client, retainedBinding, batchId, subjectScopes)
  const capturedScopes = resolved.map((inputs) =>
    decodeMediaInputs(Buffer.from(inputs.bytes), Buffer.from(inputs.digest)),
  )
  const digests = new Set(
    capturedScopes.flatMap((inputs) => inputs.versions.map((version) => version.digest)),
  )
  for (const digest of [...digests].sort()) {
    await lockBlob(client, digest)
  }
  const handles: LockedMediaInputs[] = []
  for (const inputs of capturedScopes) {
    handles.push(await capturedHandle(client, retainedBinding, identity, inputs))
  }
  return Object.freeze(handles)
}

/** The Examine lead job's batch scope: every ready evidence version, pinned like a subject scope. */
export async function lockBatchMediaInputs(
  client: PoolClient,
  binding: CaptureBinding,
  batchId: string,
): Promise<LockedMediaInputs> {
  const retainedBinding = Object.freeze({ ...binding })
  const identity = await transactionIdentity(client)
  const resolved = await resolveBatchMediaInputs(client, retainedBinding, batchId)
  const captured = decodeMediaInputs(Buffer.from(resolved.bytes), Buffer.from(resolved.digest))
  for (const digest of [...new Set(captured.versions.map((version) => version.digest))].sort()) {
    await lockBlob(client, digest)
  }
  return capturedHandle(client, retainedBinding, identity, captured)
}

/** Compatible single-scope entry point; only the captured live transaction can pin. */
export async function lockMediaInputs(
  client: PoolClient,
  binding: CaptureBinding,
  batchId: string,
  subjectIds: MediaSubjectScope,
): Promise<LockedMediaInputs> {
  const handles = await lockMediaInputScopes(client, binding, batchId, [subjectIds])
  return handles[0]
}
