import type { Pool } from 'pg'

/** Intake maintenance never uses libpq connection-string expansion or ambient credential lookup. */
export function operationalDatabase(raw: string) {
  const url = new URL(raw)
  const name = decodeURIComponent(url.pathname.slice(1))
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.search ||
    url.hash ||
    !url.username ||
    !url.password ||
    !/^intake_[a-z0-9_]{1,80}$/.test(name)
  ) {
    throw new Error('explicit_local_operational_database_required')
  }
  return { url, name }
}

export async function requireOperationalDatabase(pool: Pool, databaseUrl: string) {
  const { name } = operationalDatabase(databaseUrl)
  const actual = await pool.query<{ name: string }>('SELECT pg_catalog.current_database() AS name')
  if (actual.rowCount !== 1 || actual.rows[0].name !== name) {
    throw new Error('operational_database_mismatch')
  }
}
