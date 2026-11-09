import { randomUUID } from 'node:crypto'
import { lstat, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Pool } from 'pg'
import { grantAgentWriter } from '#/processing/grants.ts'
import { developmentRuntimeUrl } from './postgres-url.ts'

/** Private login for the Examine lead session. Kept beside app.json, never in it. */
export const AGENT_WRITER_FILE = 'agent-writer.json'

function writerPath(root: string) {
  return join(root, AGENT_WRITER_FILE)
}

/** The retained writer URL, or undefined when this namespace has not created one yet. */
export async function readAgentWriterUrl(
  root: string,
  databaseName: string,
): Promise<string | undefined> {
  const path = writerPath(root)
  let stat
  try {
    stat = await lstat(path)
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return undefined
    }
    throw new Error('private_agent_writer_required')
  }
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.uid !== process.getuid?.() ||
    stat.mode & 0o077 ||
    stat.size > 4096
  ) {
    throw new Error('private_agent_writer_required')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'))
  } catch {
    throw new Error('invalid_agent_writer_state')
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !('url' in parsed) ||
    typeof parsed.url !== 'string'
  ) {
    throw new Error('invalid_agent_writer_state')
  }
  const url = developmentRuntimeUrl(parsed.url, databaseName)
  if (!/^intake_agent_writer_[a-f0-9]{32}$/.test(url.username)) {
    throw new Error('dedicated_agent_writer_required')
  }
  return url.toString()
}

/**
 * Creates the Examine writer role once per namespace and re-applies its grants on later starts.
 * The admin URL identifies the database; the stored URL is the new role's own login.
 */
export async function ensureAgentWriter(pool: Pool, root: string, adminDatabaseUrl: string) {
  const admin = new URL(adminDatabaseUrl)
  const databaseName = admin.pathname.slice(1)
  if (!/^intake_[a-z0-9_]+$/.test(databaseName)) {
    throw new Error('owned_dev_database_required')
  }
  const existing = await readAgentWriterUrl(root, databaseName)
  const binding = `bench-intake-agent-writer:${databaseName}`
  let stored: string
  if (existing) {
    stored = existing
    const url = new URL(existing)
    if (url.hostname !== admin.hostname || (url.port || '5432') !== (admin.port || '5432')) {
      throw new Error('agent_writer_binding_mismatch')
    }
    const result = await pool.query<{ valid: boolean }>(
      `SELECT (rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
        AND NOT rolreplication AND NOT rolbypassrls
        AND shobj_description(oid, 'pg_authid') = $2) AS valid
       FROM pg_roles WHERE rolname = $1`,
      [url.username, binding],
    )
    if (result.rows[0]?.valid !== true) {
      throw new Error('agent_writer_binding_mismatch')
    }
  } else {
    const name = `intake_agent_writer_${randomUUID().replaceAll('-', '')}`
    const password = randomUUID()
    await pool.query(
      `CREATE ROLE ${name} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE CONNECTION LIMIT 4`,
    )
    await pool.query(`COMMENT ON ROLE ${name} IS '${binding}'`)
    const url = new URL(adminDatabaseUrl)
    url.username = name
    url.password = password
    stored = developmentRuntimeUrl(url.toString(), databaseName).toString()
    // Retain the identity before grants so an interrupted setup can safely retry.
    await writeFile(writerPath(root), JSON.stringify({ url: stored }), { flag: 'wx', mode: 0o600 })
  }
  const writer = new Pool({
    connectionString: stored,
    max: 1,
    connectionTimeoutMillis: 3000,
    statement_timeout: 3000,
  })
  try {
    const login = await writer.query<{ role: string; database: string }>(
      'SELECT current_user AS role, current_database() AS database',
    )
    if (
      login.rows[0]?.role !== new URL(stored).username ||
      login.rows[0]?.database !== databaseName
    ) {
      throw new Error('agent_writer_binding_mismatch')
    }
  } catch {
    throw new Error('agent_writer_login_failed')
  } finally {
    await writer.end()
  }
  await grantAgentWriter(pool, new URL(stored).username)
  return stored
}
