import type { PoolClient } from 'pg'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { captureInTransaction } from '#/capture/repository.ts'
import { fail, type CaptureBinding } from '#/capture/model.ts'
import { executeDatabaseQuery, queryDatabase } from '#/db/database.ts'
import { commands } from '#/db/schema.ts'
import { canonicalMedia } from './encoding.ts'
import { decodeMediaInputs, type MediaInputs } from './inputs.ts'
import { decodeMediaRecipe } from './projection.ts'
import { mediaBlobs, mediaCommandBindings, mediaCommandPins, mediaVersions } from './schema.ts'
import { prepareMediaTransaction } from './transaction.ts'

/** Exact immutable pin representation shared by command creation and retained verification. */
export function mediaPinSet(inputs: MediaInputs) {
  return inputs.versions
    .map((version) => ({
      version_id: version.versionId,
      blob_digest: version.digest,
      batch_id: inputs.batchId,
    }))
    .sort((left, right) => left.version_id.localeCompare(right.version_id))
}

async function verifyPinnedVersions(client: PoolClient, inputs: MediaInputs) {
  if (inputs.versions.length === 0) {
    return
  }
  const facts = await executeDatabaseQuery(
    queryDatabase(client)
      .select({
        versionId: mediaVersions.id,
        evidenceId: mediaVersions.evidenceId,
        kind: mediaVersions.kind,
        digest: mediaVersions.blobDigest,
        byteSize: mediaBlobs.byteSize,
        mediaType: mediaVersions.mediaType,
        recipeBytes: mediaVersions.recipeBytes,
        recipeDigest: mediaVersions.recipeDigest,
      })
      .from(mediaVersions)
      .innerJoin(mediaBlobs, eq(mediaVersions.blobDigest, mediaBlobs.digest))
      .where(
        and(
          eq(mediaVersions.batchId, inputs.batchId),
          inArray(
            mediaVersions.id,
            inputs.versions.map((version) => version.versionId),
          ),
        ),
      )
      .orderBy(asc(mediaVersions.id)),
  )
  const retainedVersions = facts.map((version) => ({
    versionId: version.versionId,
    evidenceId: version.evidenceId,
    kind: version.kind,
    digest: version.digest.toString('hex'),
    byteSize: version.byteSize,
    mediaType: version.mediaType,
    recipe: decodeMediaRecipe(version.recipeBytes, version.recipeDigest),
  }))
  if (canonicalMedia(retainedVersions) !== canonicalMedia(inputs.versions)) {
    fail('media_command_binding_corrupt', 409)
  }
}

/** Read-only historical authority; missing bindings are refused, never repaired or manufactured. */
export async function readCommandMediaInputs(
  client: PoolClient,
  binding: CaptureBinding,
  batchId: string,
  commandId: string,
): Promise<MediaInputs> {
  await prepareMediaTransaction(client)
  const capture = await captureInTransaction(client, binding, batchId)
  const retained = await executeDatabaseQuery(
    queryDatabase(client)
      .select({
        bytes: mediaCommandBindings.manifestBytes,
        digest: mediaCommandBindings.manifestDigest,
      })
      .from(mediaCommandBindings)
      .innerJoin(commands, eq(commands.id, mediaCommandBindings.commandId))
      .where(
        and(
          eq(mediaCommandBindings.commandId, commandId),
          eq(mediaCommandBindings.batchId, batchId),
          eq(mediaCommandBindings.actorId, binding.actorId),
          eq(mediaCommandBindings.targetId, binding.targetId),
          eq(mediaCommandBindings.targetContextId, binding.targetContextId),
          eq(commands.actorId, binding.actorId),
          eq(commands.targetId, binding.targetId),
          eq(commands.targetContextId, binding.targetContextId),
        ),
      ),
  )
  const original = retained[0]
  if (!original) {
    fail('media_command_binding_missing', 409)
  }
  const inputs = decodeMediaInputs(original.bytes, original.digest)
  const availableSubjects = new Set(
    [...capture.snapshot.parts, ...capture.snapshot.lots].map((subject) => subject.id),
  )
  if (inputs.batchId !== batchId || inputs.subjectIds.some((id) => !availableSubjects.has(id))) {
    fail('media_command_binding_corrupt', 409)
  }
  const retainedPins = await executeDatabaseQuery(
    queryDatabase(client)
      .select({
        versionId: mediaCommandPins.versionId,
        digest: mediaCommandPins.blobDigest,
        batchId: mediaCommandPins.batchId,
      })
      .from(mediaCommandPins)
      .where(eq(mediaCommandPins.commandId, commandId))
      .orderBy(asc(mediaCommandPins.versionId)),
  )
  const actualPins = retainedPins.map((pin) => ({
    version_id: pin.versionId,
    blob_digest: pin.digest.toString('hex'),
    batch_id: pin.batchId,
  }))
  if (canonicalMedia(actualPins) !== canonicalMedia(mediaPinSet(inputs))) {
    fail('media_command_binding_corrupt', 409)
  }
  await verifyPinnedVersions(client, inputs)
  return inputs
}
