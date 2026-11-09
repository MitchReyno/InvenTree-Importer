import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import sharp from 'sharp'
import { validate, type CaptureSnapshotDto } from '@invimport/contracts'
import { canonical } from '@invimport/contracts/json'
import { captureRepository } from '#/capture/repository.ts'
import { type CaptureBinding } from '#/capture/model.ts'
import { grantCaptureInputLocks } from '#/capture/grants.ts'
import { database } from '#/db/database.ts'
import { sha256 } from '#/db/authority.ts'
import { grantMedia } from '#/media/grants.ts'
import { isolatedDatabase, seedAuthority } from './database.ts'

export interface ScopeEvidence {
  evidenceId: string
  versionId: string
  digest: string
  byteSize: string
}

export interface ScopeReader {
  pool: Pool
}

export interface MediaScopeFixture {
  pool: Pool
  binding: CaptureBinding
  batch: CaptureSnapshotDto
  firstLotId: string
  secondLotId: string
  emptyLotId: string
  seedEvidence(
    subjectIds: readonly string[],
    count?: number,
    ready?: boolean,
  ): Promise<ScopeEvidence[]>
  createReader(): Promise<ScopeReader>
  dispose(): Promise<void>
}

function captureValue(value: unknown): CaptureSnapshotDto {
  validate('CaptureSnapshot', value)
  return value as CaptureSnapshotDto
}

/** Known 1px inputs and synthetic ready metadata qualify descriptors, not decoder/content access. */
async function seedEvidenceRows(
  client: PoolClient,
  binding: CaptureBinding,
  batchId: string,
  subjectIds: readonly string[],
  firstIndex: number,
  count: number,
  ready: boolean,
): Promise<ScopeEvidence[]> {
  const versions: ScopeEvidence[] = []
  await client.query('INSERT INTO media_batch(batch_id) VALUES($1) ON CONFLICT DO NOTHING', [
    batchId,
  ])
  for (let offset = 0; offset < count; offset++) {
    const index = firstIndex + offset
    const png = await sharp(Buffer.from([index % 256, Math.floor(index / 256), 91]), {
      raw: { width: 1, height: 1, channels: 3 },
    })
      .png()
      .toBuffer()
    const digest = sha256(png)
    const evidenceId = randomUUID()
    const versionId = randomUUID()
    const decodeId = randomUUID()
    await client.query(
      'INSERT INTO media_blob(digest,byte_size) VALUES($1,$2) ON CONFLICT DO NOTHING',
      [digest, png.length.toString()],
    )
    await client.query(
      'INSERT INTO media_evidence(id,batch_id,label,actor_id) VALUES($1,$2,$3,$4)',
      [evidenceId, batchId, `Owned scope evidence ${index}`, binding.actorId],
    )
    await client.query(
      `INSERT INTO media_version(id,batch_id,evidence_id,kind,blob_digest,media_type,actor_id)
       VALUES($1,$2,$3,'original',$4,'image/png',$5)`,
      [versionId, batchId, evidenceId, digest, binding.actorId],
    )
    await client.query(
      `INSERT INTO media_decode_command(id,batch_id,version_id,build)
       VALUES($1,$2,$3,'owned-scope-metadata/1')`,
      [decodeId, batchId, versionId],
    )
    if (ready) {
      await client.query(
        `INSERT INTO media_decode_result(command_id,state,decoder_build)
         VALUES($1,'ready','owned-scope-metadata/1')`,
        [decodeId],
      )
      await client.query(
        `INSERT INTO media_preview(id,batch_id,version_id,command_id,page,width,height,blob_digest)
         VALUES($1,$2,$3,$4,1,1,1,$5)`,
        [randomUUID(), batchId, versionId, decodeId, digest],
      )
    }
    if (subjectIds.length > 0) {
      const linkIds = subjectIds.map(() => randomUUID())
      await client.query(
        `INSERT INTO media_subject_link(id,batch_id,evidence_id,subject_id,linked,revision,actor_id)
         SELECT links.id,$1,$2,links.subject_id,true,1,$3
         FROM unnest($4::uuid[],$5::uuid[]) AS links(id,subject_id)`,
        [batchId, evidenceId, binding.actorId, linkIds, subjectIds],
      )
    }
    versions.push({
      evidenceId,
      versionId,
      digest: digest.toString('hex'),
      byteSize: png.length.toString(),
    })
  }
  return versions
}

export async function mediaScopeFixture(): Promise<MediaScopeFixture> {
  const db = await isolatedDatabase()
  try {
    const authority = await seedAuthority(db.pool)
    const binding: CaptureBinding = {
      actorId: authority.actor,
      targetId: authority.target,
      targetContextId: authority.context,
    }
    const capture = captureRepository(db.pool, binding)
    let batch = captureValue(
      await capture.create(randomUUID(), { title: 'Owned input scopes', note: '' }),
    )
    for (const label of ['First lot', 'Second lot', 'Empty lot']) {
      batch = captureValue(
        await capture.edit(batch.id, randomUUID(), {
          expected_revision: batch.revision,
          change: { kind: 'add_lot', label, note: '', part_subject_id: null },
        }),
      )
    }
    const firstLotId = batch.lots.find((lot) => lot.label === 'First lot')!.id
    const secondLotId = batch.lots.find((lot) => lot.label === 'Second lot')!.id
    const emptyLotId = batch.lots.find((lot) => lot.label === 'Empty lot')!.id
    const readers: { name: string; close: () => Promise<void> }[] = []
    let nextIndex = 1
    return {
      pool: db.pool,
      binding,
      batch,
      firstLotId,
      secondLotId,
      emptyLotId,

      async seedEvidence(subjectIds, count = 1, ready = true) {
        const client = await db.pool.connect()
        try {
          await client.query('BEGIN')
          const entries = await seedEvidenceRows(
            client,
            binding,
            batch.id,
            subjectIds,
            nextIndex,
            count,
            ready,
          )
          nextIndex += count
          await client.query('COMMIT')
          return entries
        } catch (error) {
          await client.query('ROLLBACK')
          throw error
        } finally {
          client.release()
        }
      },

      async createReader() {
        const name = `intake_scope_${randomUUID().replaceAll('-', '')}`
        const password = randomUUID()
        await db.pool.query(
          `CREATE ROLE ${name} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE CONNECTION LIMIT 1`,
        )
        const ownedReader = { name, close: async () => {} }
        readers.push(ownedReader)
        await grantCaptureInputLocks(db.pool, name)
        await grantMedia(db.pool, name, 'processing-reader')
        await db.pool.query(`GRANT SELECT ON command,ui_stream TO ${name}`)
        const url = new URL(db.url)
        url.username = name
        url.password = password
        const runtime = database(url.toString())
        ownedReader.close = runtime.close
        return { pool: runtime.pool }
      },

      async dispose() {
        for (const reader of readers) {
          await reader.close()
          await db.pool.query(`DROP OWNED BY ${reader.name}`)
          await db.pool.query(`DROP ROLE ${reader.name}`)
        }
        await db.dispose()
      },
    }
  } catch (error) {
    await db.dispose()
    throw error
  }
}

export async function insertScopeCommand(
  client: PoolClient,
  binding: CaptureBinding,
  batchId: string,
  manifestDigest: string,
): Promise<string> {
  const commandId = randomUUID()
  const payload = Buffer.from(canonical({ batchId, manifestDigest }))
  await client.query(
    `INSERT INTO command(id,actor_id,target_id,target_context_id,kind,handler_version,
       workflow_id,queue_name,payload_bytes,payload_digest)
     VALUES($1,$2,$3,$4,'process','owned-media-scope/1',$5,'owned-media-scope',$6,$7)`,
    [
      commandId,
      binding.actorId,
      binding.targetId,
      binding.targetContextId,
      `owned-media-scope:${commandId}`,
      payload,
      sha256(payload),
    ],
  )
  return commandId
}
