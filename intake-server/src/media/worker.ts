import { prepareMediaTransaction } from './transaction.ts'
import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import type { MediaRecipeDto } from '@invimport/contracts'
import { assertMediaRecipe } from '@invimport/contracts/media'
import { mediaDecodeClaims, mediaDecodeResults, mediaPreviews, mediaVersions } from './schema.ts'
import { strictJson } from '@invimport/contracts/json'
import { appendEvent, sha256, verifyBytes } from '../db/authority.ts'
import { executeDatabaseQuery, queryDatabase, transaction } from '../db/database.ts'
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
    await prepareMediaTransaction(client)
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
    await executeDatabaseQuery(
      queryDatabase(client).insert(mediaDecodeClaims).values({
        commandId: command.id,
        ownerId: randomUUID(),
      }),
    )
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
  assertMediaRecipe(recipe)
  return recipe
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
  await executeDatabaseQuery(
    queryDatabase(client)
      .insert(mediaVersions)
      .values({
        id: command.derivation_id,
        batchId: command.batch_id,
        evidenceId: command.evidence_id,
        kind: 'derived',
        blobDigest: Buffer.from(blob.digest, 'hex'),
        mediaType: 'image/png',
        sourceVersionId: command.version_id,
        recipeBytes: command.recipe_bytes,
        recipeDigest: command.recipe_digest,
        actorId: command.actor_id,
      }),
  )
  return command.derivation_id
}

async function publishDecoded(
  pool: Pool,
  store: BlobStore,
  binding: CaptureBinding,
  command: MediaCommand,
  image: string,
  decoded: DecodedMedia | { state: 'interrupted'; toolchain: string; pages: [] },
) {
  return transaction(pool, async (client) => {
    await prepareMediaTransaction(client)
    const capture = await captureInTransaction(client, binding, command.batch_id)
    await lockMediaRevision(client, command.batch_id)
    const digests = decoded.pages.map((page) => sha256(page.bytes).toString('hex'))
    for (const digest of [...new Set(digests)].sort()) {
      await lockBlob(client, digest)
    }
    // Ready and every output are committed together after all durable publications.
    await executeDatabaseQuery(
      queryDatabase(client)
        .insert(mediaDecodeResults)
        .values({
          commandId: command.id,
          state: decoded.state,
          decoderBuild: `${DECODER_BUILD};${MEDIA_TOOLCHAIN};${image}`,
        }),
    )
    if (decoded.state === 'ready') {
      const versionId = await publishDerivedVersion(client, store, command, decoded)
      for (const page of decoded.pages) {
        const blob = await store.publish(client, page.bytes)
        await retainBlob(client, blob)
        await executeDatabaseQuery(
          queryDatabase(client)
            .insert(mediaPreviews)
            .values({
              id: randomUUID(),
              batchId: command.batch_id,
              versionId,
              commandId: command.id,
              page: page.page,
              width: page.width,
              height: page.height,
              blobDigest: Buffer.from(blob.digest, 'hex'),
            }),
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
  let decoded: DecodedMedia | { state: 'interrupted'; toolchain: string; pages: [] }
  try {
    const bytes = await store.read(command.blob_digest.toString('hex'))
    decoded = await decodeIsolated(image, {
      version: 'media-decode/1',
      digest: command.blob_digest.toString('hex'),
      bytes,
      recipe: retainedRecipe(command),
    })
  } catch {
    // Unknown infrastructure/library failures do not claim the source is malformed.
    decoded = { state: 'interrupted', toolchain: MEDIA_TOOLCHAIN, pages: [] }
  }
  await publishDecoded(pool, store, binding, command, image, decoded)
  return true
}
