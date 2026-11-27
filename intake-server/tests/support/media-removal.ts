import { createHash, randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import sharp from 'sharp'
import type { MediaEditDto, MediaSnapshotDto } from '@invimport/contracts'
import { transaction } from '#/db/database.ts'
import { editMedia } from '#/media/edit.ts'
import { operatorMediaSnapshot } from '#/media/read.ts'
import { CaptureError, type CaptureBinding } from '#/capture/model.ts'
import type { BlobStore } from '#/media/blob-store.ts'

/** A small distinct PNG and its half-size preview; `seed` changes the colour, so the bytes differ. */
export async function photoBytes(seed: number) {
  const background = { r: seed % 256, g: (seed * 7) % 256, b: (seed * 13) % 256 }
  const original = await sharp({ create: { width: 64, height: 48, channels: 3, background } })
    .png()
    .toBuffer()
  const preview = await sharp(original).resize(32, 24).png().toBuffer()
  return { original, preview }
}

/**
 * A ready photo as the decoder would leave it, seeded by the migration owner: its original and
 * preview bytes are in the store, with one decoded page.
 */
export async function seedStoredPhoto(
  owner: Pool,
  store: BlobStore,
  input: { batchId: string; actorId: string; label: string; seed: number },
) {
  const { original, preview } = await photoBytes(input.seed)
  const ids = {
    evidence: randomUUID(),
    version: randomUUID(),
    decode: randomUUID(),
    preview: randomUUID(),
  }
  await transaction(owner, async (client) => {
    await store.publish(client, original)
    await store.publish(client, preview)
    await client.query('INSERT INTO media_batch(batch_id) VALUES($1) ON CONFLICT DO NOTHING', [
      input.batchId,
    ])
    for (const bytes of [original, preview]) {
      await client.query(
        'INSERT INTO media_blob(digest,byte_size) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [createHash('sha256').update(bytes).digest(), bytes.length.toString()],
      )
    }
    await client.query(
      'INSERT INTO media_evidence(id,batch_id,label,actor_id) VALUES($1,$2,$3,$4)',
      [ids.evidence, input.batchId, input.label, input.actorId],
    )
    await client.query(
      `INSERT INTO media_version(id,batch_id,evidence_id,kind,blob_digest,media_type,actor_id)
       VALUES($1,$2,$3,'original',$4,'image/png',$5)`,
      [
        ids.version,
        input.batchId,
        ids.evidence,
        createHash('sha256').update(original).digest(),
        input.actorId,
      ],
    )
    await client.query(
      "INSERT INTO media_decode_command(id,batch_id,version_id,build) VALUES($1,$2,$3,'removal-fixture/1')",
      [ids.decode, input.batchId, ids.version],
    )
    await client.query(
      "INSERT INTO media_decode_result(command_id,state,decoder_build) VALUES($1,'ready','removal-fixture/1')",
      [ids.decode],
    )
    await client.query(
      `INSERT INTO media_preview(id,batch_id,version_id,command_id,page,width,height,blob_digest)
       VALUES($1,$2,$3,$4,1,32,24,$5)`,
      [
        ids.preview,
        input.batchId,
        ids.version,
        ids.decode,
        createHash('sha256').update(preview).digest(),
      ],
    )
  })
  return { ...ids, original, previewBytes: preview }
}

export function mediaEditor(pool: Pool, binding: CaptureBinding, batchId: string) {
  const snapshot = () =>
    transaction(pool, (client) => operatorMediaSnapshot(client, binding, batchId))

  /** One edit at the current revision (or the given one); a refusal returns its code. */
  async function edit(
    change: MediaEditDto['change'],
    options: { key?: string; revision?: string } = {},
  ): Promise<MediaSnapshotDto | { refused: string; status: number }> {
    const revision = options.revision ?? (await snapshot()).revision
    try {
      return (await editMedia(pool, binding, batchId, options.key ?? randomUUID(), {
        expected_revision: revision,
        change,
      })) as MediaSnapshotDto
    } catch (error) {
      if (error instanceof CaptureError) {
        return { refused: error.code, status: error.statusCode }
      }
      throw error
    }
  }

  async function applied(change: MediaEditDto['change'], options: { key?: string } = {}) {
    const result = await edit(change, options)
    if ('refused' in result) {
      throw new Error(`media_edit_refused:${result.refused}`)
    }
    return result
  }

  return { snapshot, edit, applied }
}
