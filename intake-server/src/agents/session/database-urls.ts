import { Client } from 'pg'

/**
 * A PostgreSQL URL for a loopback server, checked both as written and as the `pg` driver reads
 * it, so the identity DBOS derives from the URL is the one the driver connects to.
 */
export function localDatabaseUrl(value: string | undefined) {
  if (!value) {
    throw new Error('agent_database_required')
  }
  // A NUL in any field, encoded or not, would reach the PostgreSQL startup packet.
  if (value.includes('\0') || /%00/i.test(value)) {
    throw new Error('local_agent_database_required')
  }
  let host = ''
  let port = 0
  try {
    const url = new URL(value)
    // The URL's own authority must be loopback, and `pg` must not be told to go elsewhere.
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      url.searchParams.has('host') ||
      url.searchParams.has('hostaddr')
    ) {
      throw new Error('local_agent_database_required')
    }
    ;({ host, port } = new Client({ connectionString: value }))
  } catch {
    throw new Error('local_agent_database_required')
  }
  if (
    !['127.0.0.1', 'localhost', '::1'].includes(host) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error('local_agent_database_required')
  }
  return value
}

/** The scheduler URL, with the fields DBOS requires when it launches, checked before recovery. */
export function schedulerDatabaseUrl(value: string | undefined) {
  const checked = localDatabaseUrl(value)
  const url = new URL(checked)
  // DBOS requires a user and a path of 1 to 63 characters, and names the database by
  // `decodeURI` of that path; `pg` must connect to the same one.
  const path = url.pathname.slice(1)
  let name: string
  try {
    name = decodeURI(path)
  } catch {
    throw new Error('local_agent_database_required')
  }
  if (
    !url.username ||
    path.length < 1 ||
    path.length > 63 ||
    new Client({ connectionString: checked }).database !== name
  ) {
    throw new Error('local_agent_database_required')
  }
  return checked
}

/** The scheduler refuses a connection within this long when its server is unreachable. */
const SCHEDULER_CONNECT_TIMEOUT_MS = 5000

/**
 * Connects to the scheduler database once and disconnects, so stale credentials or an
 * unreachable server stop startup before recovery changes any retained session.
 */
export async function schedulerReachable(url: string) {
  const client = new Client({
    connectionString: url,
    connectionTimeoutMillis: SCHEDULER_CONNECT_TIMEOUT_MS,
  })
  try {
    await client.connect()
  } finally {
    await client.end().catch(() => undefined)
  }
}
