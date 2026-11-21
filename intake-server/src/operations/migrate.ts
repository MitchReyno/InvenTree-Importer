import { readdir, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import type { Pool } from 'pg'
import { transaction } from '#/db/database.ts'

export async function migrate(pool: Pool): Promise<void> {
  const directory = new URL('../../migrations/', import.meta.url)
  await transaction(pool, async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('bench-intake-migrations',0))",
    )
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migration (name text PRIMARY KEY, sha256 text NOT NULL)',
    )
    for (const name of (await readdir(directory))
      .filter((name) => /^\d{4}_[a-z_]+\.sql$/.test(name))
      .sort()) {
      const sql = await readFile(new URL(name, directory), 'utf8')
      const digest = createHash('sha256').update(sql).digest('hex')
      const existing = await client.query<{ sha256: string }>(
        'SELECT sha256 FROM schema_migration WHERE name=$1',
        [name],
      )
      if (existing.rowCount) {
        if (existing.rows[0].sha256 !== digest) {
          throw new Error('migration_drift')
        }
      } else {
        await client.query(sql)
        await client.query('INSERT INTO schema_migration VALUES ($1,$2)', [name, digest])
      }
    }
  })
}
