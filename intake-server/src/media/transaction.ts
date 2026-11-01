import type { PoolClient } from 'pg'

/** Caller owns BEGIN/COMMIT. Explicit pg_temp placement prevents temporary relation precedence. */
export async function prepareMediaTransaction(client: PoolClient) {
  await client.query('SET LOCAL search_path = pg_catalog, public, pg_temp')
}
