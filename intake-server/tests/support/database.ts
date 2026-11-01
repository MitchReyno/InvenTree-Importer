import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { database } from '../../src/db/database.ts'
import { migrate } from '../../src/operations/migrate.ts'

export async function isolatedDatabase() {
  const url = process.env.INTAKE_TEST_ADMIN_URL
  if (!url || process.env.INTAKE_TEST_ALLOW_CREATE_DATABASE !== 'owned-sandbox')
    throw new Error('explicit_owned_test_database_required')
  const parsed = new URL(url)
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) ||
    parsed.pathname !== '/postgres'
  )
    throw new Error('test_database_must_be_local_admin')
  const name = `intake_test_${randomUUID().replaceAll('-', '')}`
  const admin = new Pool({ connectionString: url, max: 1 })
  await admin.query(`CREATE DATABASE ${name}`)
  parsed.pathname = `/${name}`
  const db = database(parsed.toString())
  try {
    await migrate(db.pool)
  } catch (error) {
    await db.close()
    await admin.query(`DROP DATABASE ${name}`)
    await admin.end()
    throw error
  }
  return {
    ...db,
    url: parsed.toString(),
    name,
    async dispose() {
      await db.close()
      await admin.query(`DROP DATABASE ${name}`)
      await admin.end()
    },
  }
}
export async function seedAuthority(pool: Pool) {
  const actor = randomUUID(),
    target = randomUUID(),
    context = randomUUID()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('INSERT INTO operator VALUES ($1,$2,$3)', [
      actor,
      'development',
      `fixture-${actor}`,
    ])
    await client.query('INSERT INTO target(id,current_context_id,profile) VALUES ($1,$2,$3)', [
      target,
      context,
      'owned-disposable',
    ])
    await client.query('INSERT INTO target_context VALUES ($1,$2,1,$3)', [
      context,
      target,
      Buffer.alloc(32),
    ])
    await client.query('COMMIT')
  } finally {
    client.release()
  }
  return { actor, target, context }
}
