import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { isolatedDatabase, seedAuthority } from '../support/database.ts'
import { transaction } from '#/db/database.ts'
import { migrate } from '#/operations/migrate.ts'
import { compatibleSchema } from '#/operations/compatibility.ts'
import { mediaSnapshot } from '#/media/read.ts'

const REMOVAL_MIGRATION = '0031_media_evidence_removal.sql'

/** Applies the reviewed migrations before the removal one, as a database deployed before it. */
async function migrateBeforeRemoval(pool: import('pg').Pool) {
  const directory = new URL('../../migrations/', import.meta.url)
  await pool.query(
    'CREATE TABLE IF NOT EXISTS schema_migration (name text PRIMARY KEY, sha256 text NOT NULL)',
  )
  const names = (await readdir(directory))
    .filter((name) => /^\d{4}_[a-z_]+\.sql$/.test(name) && name < REMOVAL_MIGRATION)
    .sort()
  for (const name of names) {
    const sql = await readFile(new URL(name, directory), 'utf8')
    await pool.query(sql)
    await pool.query('INSERT INTO schema_migration VALUES ($1,$2)', [
      name,
      createHash('sha256').update(sql).digest('hex'),
    ])
  }
}

test('migration 0031 applies over existing evidence, which stays present with no removal rows', async () => {
  const db = await isolatedDatabase({ migrate: false })
  try {
    await migrateBeforeRemoval(db.pool)
    const identity = await seedAuthority(db.pool)
    const binding = {
      actorId: identity.actor,
      targetId: identity.target,
      targetContextId: identity.context,
    }
    // This build's capture code reads the new table, so the batch is seeded as rows.
    const batch = { id: randomUUID() }
    const evidenceId = randomUUID()
    const versionId = randomUUID()
    const digest = createHash('sha256').update('existing evidence').digest()
    await transaction(db.pool, async (client) => {
      const source = randomUUID()
      const stream = randomUUID()
      await client.query(
        'INSERT INTO capture_source(id,namespace_key,created_by) VALUES($1,$2,$3)',
        [source, `native_batch:${source}`, identity.actor],
      )
      await client.query('INSERT INTO ui_stream(id,stream_key) VALUES($1,$2)', [
        stream,
        `capture:${batch.id}`,
      ])
      await client.query(
        `INSERT INTO capture_batch(id,source_id,actor_id,target_id,target_context_id,stream_id,title)
         VALUES($1,$2,$3,$4,$5,$6,'Before removal existed')`,
        [batch.id, source, identity.actor, identity.target, identity.context, stream],
      )
      await client.query('INSERT INTO media_batch(batch_id) VALUES($1)', [batch.id])
      await client.query("INSERT INTO media_blob(digest,byte_size) VALUES($1,'17')", [digest])
      await client.query(
        'INSERT INTO media_evidence(id,batch_id,label,actor_id) VALUES($1,$2,$3,$4)',
        [evidenceId, batch.id, 'Existing photo', identity.actor],
      )
      await client.query(
        `INSERT INTO media_version(id,batch_id,evidence_id,kind,blob_digest,media_type,actor_id)
         VALUES($1,$2,$3,'original',$4,'image/png',$5)`,
        [versionId, batch.id, evidenceId, digest, identity.actor],
      )
    })
    assert.equal(await compatibleSchema(db.pool), false, 'this build needs the removal migration')

    await migrate(db.pool)

    assert.equal(await compatibleSchema(db.pool), true)
    const removals = await db.pool.query('SELECT 1 FROM media_evidence_removal')
    assert.equal(removals.rowCount, 0)
    const snapshot = await transaction(db.pool, (client) =>
      mediaSnapshot(client, binding, batch.id),
    )
    assert.deepEqual(
      snapshot.evidence.map((item) => [item.id, item.versions.map((version) => version.id)]),
      [[evidenceId, [versionId]]],
    )
    assert.equal(snapshot.removed, undefined)
  } finally {
    await db.dispose()
  }
})
