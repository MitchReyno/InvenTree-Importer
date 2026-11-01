import type { Pool, PoolClient } from 'pg'

/** No retries, including uncertain COMMITs. A borrowed pg client emits errors separately
 * from a rejected query when its socket disappears; consume both and destroy that client.
 * Caller reconnects only to INSPECT stable authority, never to retry a remote mutation.
 */
export async function executorTransaction<T>(
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
