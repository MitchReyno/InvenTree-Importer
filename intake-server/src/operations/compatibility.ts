import { readdir, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'

export async function expectedMigrations() {
  const directory = new URL('../../migrations/', import.meta.url)
  return Promise.all(
    (await readdir(directory))
      .filter((name) => /^\d{4}_[a-z_]+\.sql$/.test(name))
      .sort()
      .map(async (name) => ({
        name,
        sha256: createHash('sha256')
          .update(await readFile(new URL(name, directory)))
          .digest('hex'),
      })),
  )
}

/** Inspection only. An unknown version is quarantine, never automatic DDL or plan reinterpretation. */
export async function compatibleSchema(connection: Pool | PoolClient): Promise<boolean> {
  const expected = await expectedMigrations()
  const actual = await connection.query<{ name: string; sha256: string }>(
    'SELECT name,sha256 FROM public.schema_migration ORDER BY name',
  )
  return (
    actual.rows.length === expected.length &&
    actual.rows.every(
      (row, index) => row.name === expected[index].name && row.sha256 === expected[index].sha256,
    )
  )
}
