import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { validate, type MediaRecipeDto } from '@invimport/contracts'
import { strictJson } from '@invimport/contracts/json'
import { appendEvent, sha256, verifyBytes } from '../db/authority.ts'
import { transaction } from '../db/database.ts'
import { captureInTransaction, type CaptureBinding } from '../capture/repository.ts'
import { BlobStore, lockBlob } from './blob-store.ts'
import { lockMediaRevision } from './commands.ts'
import { retainBlob } from './blob-reference.ts'
import { decodeIsolated } from './decoder-runner.ts'
import { MEDIA_TOOLCHAIN, type DecodedMedia } from './decoder-protocol.ts'
import { DECODER_BUILD } from './repository.ts'

interface MediaCommand {
  id: string
  batch_id: string
  version_id: string
  derivation_id: string | null
  evidence_id: string
  blob_digest: Buffer
  recipe_bytes: Buffer | null
  recipe_digest: Buffer | null
  actor_id: string
}

async function claimCommand(pool: Pool, binding: CaptureBinding): Promise<MediaCommand | null> {
  return transaction(pool, async (client) => {
    const commands = await client.query<MediaCommand>(
      `SELECT c.id,c.batch_id,c.version_id,c.derivation_id,
              v.evidence_id,v.blob_digest,v.actor_id,d.recipe_bytes,d.recipe_digest
       FROM media_decode_command c
       JOIN media_version v ON v.id=c.version_id AND v.batch_id=c.batch_id
       JOIN capture_batch b ON b.id=c.batch_id
       LEFT JOIN media_derivation d ON d.id=c.derivation_id
       WHERE c.build=$1 AND b.actor_id=$2 AND b.target_id=$3 AND b.target_context_id=$4
         AND NOT EXISTS(SELECT 1 FROM media_decode_claim claim WHERE claim.command_id=c.id)
       ORDER BY c.created_at,c.id LIMIT 1 FOR UPDATE OF c SKIP LOCKED`,
      [DECODER_BUILD, binding.actorId, binding.targetId, binding.targetContextId],
    )
    const command = commands.rows[0]
    if (!command) {
      return null
    }
    await client.query('INSERT INTO media_decode_claim(command_id,owner_id) VALUES($1,$2)', [
      command.id,
      randomUUID(),
    ])
    return command
  })
}

function retainedRecipe(command: MediaCommand): MediaRecipeDto | undefined {
  if (!command.derivation_id) {
    if (command.recipe_bytes || command.recipe_digest) {
      throw new Error('unexpected_decode_recipe')
    }
    return undefined
  }
  if (!command.recipe_bytes || !command.recipe_digest) {
    throw new Error('recipe_authority_missing')
  }
  verifyBytes(command.recipe_bytes, command.recipe_digest)
  const recipe = strictJson(command.recipe_bytes.toString('utf8'))
  validate('MediaRecipe', recipe)
  return recipe as MediaRecipeDto
}

async function publishDerivedVersion(
  client: PoolClient,
  store: BlobStore,
  command: MediaCommand,
  decoded: Extract<DecodedMedia, { state: 'ready' }>,
) {
  if (!command.derivation_id) {
    return command.version_id
  }
  if (decoded.pages.length !== 1) {
    throw new Error('invalid_derived_page_count')
  }
  const blob = await store.publish(client, decoded.pages[0].bytes)
  await retainBlob(client, blob)
  await client.query(
    `INSERT INTO media_version(id,batch_id,evidence_id,kind,blob_digest,media_type,
                               source_version_id,recipe_bytes,recipe_digest,actor_id)
     VALUES($1,$2,$3,'derived',$4,'image/png',$5,$6,$7,$8)`,
    [
      command.derivation_id,
      command.batch_id,
      command.evidence_id,
      Buffer.from(blob.digest, 'hex'),
      command.version_id,
      command.recipe_bytes,
      command.recipe_digest,
      command.actor_id,
    ],
  )
  return command.derivation_id
}

async function publishDecoded(
  pool: Pool,
  store: BlobStore,
  binding: CaptureBinding,
  command: MediaCommand,
  image: string,
  decoded: DecodedMedia,
) {
  return transaction(pool, async (client) => {
    const capture = await captureInTransaction(client, binding, command.batch_id)
    await lockMediaRevision(client, command.batch_id)
    const digests = decoded.pages.map((page) => sha256(page.bytes).toString('hex'))
    for (const digest of [...new Set(digests)].sort()) {
      await lockBlob(client, digest)
    }
    // Ready and every output are committed together after all durable publications.
    await client.query(
      `INSERT INTO media_decode_result(command_id,state,decoder_build)
       VALUES($1,$2,$3)`,
      [command.id, decoded.state, `${DECODER_BUILD};${MEDIA_TOOLCHAIN};${image}`],
    )
    if (decoded.state === 'ready') {
      const versionId = await publishDerivedVersion(client, store, command, decoded)
      for (const page of decoded.pages) {
        const blob = await store.publish(client, page.bytes)
        await retainBlob(client, blob)
        await client.query(
          `INSERT INTO media_preview(id,batch_id,version_id,command_id,page,width,height,blob_digest)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            randomUUID(),
            command.batch_id,
            versionId,
            command.id,
            page.page,
            page.width,
            page.height,
            Buffer.from(blob.digest, 'hex'),
          ],
        )
      }
    }
    await appendEvent(client, capture.streamId, 'media_prepared', {
      batch_id: command.batch_id,
      version_id: command.derivation_id ?? command.version_id,
      state: decoded.state,
    })
  })
}

/** Explicit one-command worker. A claimed interrupted command is never automatically replayed. */
export async function processMediaCommand(
  pool: Pool,
  store: BlobStore,
  binding: CaptureBinding,
  image: string,
) {
  const command = await claimCommand(pool, binding)
  if (!command) {
    return false
  }
  const bytes = await store.read(command.blob_digest.toString('hex'))
  const recipe = retainedRecipe(command)
  const decoded = await decodeIsolated(image, {
    version: 'media-decode/1',
    digest: command.blob_digest.toString('hex'),
    bytes,
    recipe,
  })
  await publishDecoded(pool, store, binding, command, image, decoded)
  return true
}
