import { Client, Pool, type PoolClient } from 'pg'
import { DrizzleQueryError } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from './schema.ts'

/** Reuse the caller's connection and transaction; this adapter never checks out a client. */
export function queryDatabase(connection: Pool | PoolClient) {
  return drizzle(connection, { schema })
}

/** Preserve pg failure identity without Drizzle's additional SQL/parameter-bearing wrapper. */
export async function executeDatabaseQuery<T>(query: PromiseLike<T>): Promise<T> {
  try {
    return await query
  } catch (error) {
    if (error instanceof DrizzleQueryError && error.cause) {
      throw error.cause
    }
    throw error
  }
}

/** Explicit database only; no default connection, secret discovery or import-time work. */
export function database(connectionString: string) {
  const pool = new Pool({
    connectionString,
    max: 4,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 5000,
    statement_timeout: 5000,
    idle_in_transaction_session_timeout: 10000,
  })
  pool.on('error', () => {
    /* No reconnect confers writer authority. Apply owns fatal lock loss. */
  })
  return { pool, orm: queryDatabase(pool), close: () => pool.end() }
}

/** The parts of node-postgres's protocol cancel that its types leave out. */
interface CancellingClient {
  connection: { on(event: 'error', listener: () => void): void }
  cancel(target: PoolClient, query: unknown): void
}

/**
 * Asks the server to stop the statement a pool client is running, with a protocol cancel request
 * on a fresh socket rather than a new session, so it works when the role's connection limit is
 * reached. Best effort: the server answers nothing, and a refused socket is ignored.
 */
export function cancelRunningStatement(pool: Pool, target: PoolClient) {
  const running = (target as PoolClient & { activeQuery?: unknown }).activeQuery
  if (!running) {
    return
  }
  const canceller = new Client(pool.options) as unknown as CancellingClient
  canceller.connection.on('error', () => undefined)
  canceller.cancel(target, running)
}

export async function transaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  let broken = false

  const onError = () => {
    broken = true
  }

  client.on('error', onError)
  try {
    await client.query('BEGIN')
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    broken = true
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release(broken)
    client.removeListener('error', onError)
  }
}
