import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { isolatedDatabase, seedAuthority } from '../support/database.ts'
import { transaction } from '../../src/db/database.ts'
import { appendEvent, idempotent, sha256, verifyBytes } from '../../src/db/authority.ts'
import { migrate } from '../../src/operations/migrate.ts'
import { streams } from '../../src/db/schema.ts'
import { grantFoundation } from '../../src/operations/grants.ts'
import { readFile } from 'node:fs/promises'
import { canonical } from '@invimport/contracts/json'
import { validate } from '@invimport/contracts'

test('real PG migration, deferred target cycle, wrong-parent FK, digest length and append-only authority', async () => {
  const db = await isolatedDatabase()
  try {
    await migrate(db.pool)
    const first = await seedAuthority(db.pool),
      second = await seedAuthority(db.pool)
    await assert.rejects(
      transaction(db.pool, (c) =>
        c.query('UPDATE target SET current_context_id=$1 WHERE id=$2', [
          second.context,
          first.target,
        ]),
      ),
      { code: '23503' },
    )
    await assert.rejects(
      db.pool.query('INSERT INTO target_context VALUES ($1,$2,2,$3)', [
        randomUUID(),
        first.target,
        Buffer.alloc(31),
      ]),
      { code: '23514' },
    )
    await assert.rejects(
      db.pool.query('UPDATE target_context SET generation=3 WHERE id=$1', [first.context]),
      /immutable_authority/,
    )
    await assert.rejects(db.pool.query('DELETE FROM target WHERE id=$1', [first.target]), {
      code: '23503',
    })
    await assert.rejects(
      transaction(db.pool, (c) =>
        c.query('INSERT INTO target(id,current_context_id,profile) VALUES ($1,$2,$3)', [
          randomUUID(),
          randomUUID(),
          'owned-disposable',
        ]),
      ),
      { code: '23503' },
    )
    const role = `intake_${randomUUID().replaceAll('-', '')}`
    await db.pool.query(`CREATE ROLE ${role} NOSUPERUSER NOCREATEDB NOCREATEROLE`)
    try {
      await grantFoundation(db.pool, role)
      await assert.rejects(
        transaction(db.pool, async (c) => {
          await c.query(`SET LOCAL ROLE ${role}`)
          await c.query('CREATE TABLE forbidden(id uuid)')
        }),
        { code: '42501' },
      )
      await assert.rejects(
        transaction(db.pool, async (c) => {
          await c.query(`SET LOCAL ROLE ${role}`)
          await c.query('UPDATE target SET revision=revision+1')
        }),
        { code: '42501' },
      )
      await transaction(db.pool, async (c) => {
        await c.query(`SET LOCAL ROLE ${role}`)
        assert.equal((await c.query('SELECT count(*) FROM target')).rows[0].count, '2')
      })
    } finally {
      await db.pool.query(`DROP OWNED BY ${role}`)
      await db.pool.query(`DROP ROLE ${role}`)
    }
    await db.pool.query("UPDATE schema_migration SET sha256='drift'")
    await assert.rejects(migrate(db.pool), /migration_drift/)
  } finally {
    await db.dispose()
  }
})
test('real PG exact same-batch/wrong-job selected-attempt cycle pattern (fixture DDL, not catalogue scaffolding)', async () => {
  const db = await isolatedDatabase()
  try {
    await db.pool
      .query(`CREATE TABLE fixture_job(batch_id uuid,id uuid,selected_attempt_id uuid,PRIMARY KEY(batch_id,id));
      CREATE TABLE fixture_attempt(batch_id uuid,job_id uuid,id uuid,PRIMARY KEY(batch_id,job_id,id),FOREIGN KEY(batch_id,job_id) REFERENCES fixture_job(batch_id,id));
      ALTER TABLE fixture_job ADD FOREIGN KEY(batch_id,id,selected_attempt_id) REFERENCES fixture_attempt(batch_id,job_id,id) DEFERRABLE INITIALLY DEFERRED;`)
    const batch = randomUUID(),
      jobA = randomUUID(),
      jobB = randomUUID(),
      attempt = randomUUID()
    await transaction(db.pool, async (c) => {
      await c.query('INSERT INTO fixture_job VALUES ($1,$2,$3),($1,$4,NULL)', [
        batch,
        jobA,
        attempt,
        jobB,
      ])
      await c.query('INSERT INTO fixture_attempt VALUES ($1,$2,$3)', [batch, jobA, attempt])
    })
    await assert.rejects(
      transaction(db.pool, (c) =>
        c.query('UPDATE fixture_job SET selected_attempt_id=$1 WHERE id=$2', [attempt, jobB]),
      ),
      { code: '23503' },
    )
  } finally {
    await db.dispose()
  }
})
test('real PG semantic idempotency is concurrent, atomic, exact and persistent; event order/rollback and bigint driver', async () => {
  const db = await isolatedDatabase()
  try {
    const { actor } = await seedAuthority(db.pool)
    const scope = { actorId: actor, action: 'fixture', resourceKey: 'fixture', key: 'same' }
    await db.pool.query('CREATE TABLE fixture_business(id text PRIMARY KEY)')
    let calls = 0
    const apply = (payload: unknown) =>
      transaction(db.pool, (c) =>
        idempotent(c, scope, payload, async () => {
          calls++
          await c.query("INSERT INTO fixture_business VALUES ('retained')")
          return { id: 'retained' }
        }),
      )
    assert.deepEqual(await Promise.all([apply({ a: '1', b: '2' }), apply({ b: '2', a: '1' })]), [
      { id: 'retained' },
      { id: 'retained' },
    ])
    assert.equal(calls, 1)
    assert.deepEqual((await db.pool.query('SELECT id FROM fixture_business')).rows, [
      { id: 'retained' },
    ])
    await assert.rejects(apply({ a: '2', b: '2' }), /payload_conflict/)
    await assert.rejects(
      transaction(db.pool, (c) =>
        idempotent(c, { ...scope, key: 'rollback' }, { a: '3' }, async () => {
          await c.query("INSERT INTO fixture_business VALUES ('must-rollback')")
          throw new Error('controlled_domain_failure')
        }),
      ),
      /controlled_domain_failure/,
    )
    assert.equal(
      (await db.pool.query("SELECT count(*) FROM fixture_business WHERE id='must-rollback'"))
        .rows[0].count,
      '0',
    )
    assert.equal(
      (await db.pool.query("SELECT count(*) FROM idempotency_record WHERE key='rollback'")).rows[0]
        .count,
      '0',
    )
    const retained = (
      await db.pool.query('SELECT semantic_bytes,semantic_digest FROM idempotency_record')
    ).rows[0]
    verifyBytes(retained.semantic_bytes, retained.semantic_digest)
    assert.throws(() => verifyBytes(Buffer.from('corrupt'), retained.semantic_digest), /corrupt/)
    assert.equal(
      sha256('abc').toString('hex'),
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
    const stream = randomUUID()
    await db.pool.query('INSERT INTO ui_stream VALUES ($1,$2,$3)', [
      stream,
      'fixture',
      '9007199254740993',
    ])
    assert.equal((await db.orm.select().from(streams))[0].head, 9007199254740993n)
    const a = await db.pool.connect(),
      b = await db.pool.connect()
    try {
      await a.query('BEGIN')
      await b.query('BEGIN')
      const first = await appendEvent(a, stream, 'fixture', { value: 'a' })
      await b.query("SET LOCAL lock_timeout='100ms'")
      await assert.rejects(appendEvent(b, stream, 'fixture', { value: 'b' }), { code: '55P03' })
      await b.query('ROLLBACK')
      await a.query('COMMIT')
      assert.equal(first, '9007199254740994')
      await b.query('BEGIN')
      assert.equal(await appendEvent(b, stream, 'fixture', { value: 'b' }), '9007199254740995')
      await b.query('ROLLBACK')
      assert.equal((await db.pool.query('SELECT head FROM ui_stream')).rows[0].head, first)
      assert.equal((await db.pool.query('SELECT count(*) FROM ui_event')).rows[0].count, '1')
    } finally {
      a.release()
      b.release()
    }
  } finally {
    await db.dispose()
  }
})

test('real PG numeric(19,6) fidelity after boundary validation and retained UTF-8 vector round-trip', async () => {
  const db = await isolatedDatabase()
  try {
    await db.pool.query('CREATE TABLE fixture_quantity(value numeric(19,6) NOT NULL)')
    const insert = async (value: string) => {
      validate('LotSelection', { expected_revision: '1', quantity: { mode: 'set', value } })
      await db.pool.query('INSERT INTO fixture_quantity VALUES ($1)', [value])
    }
    for (const value of ['0.000001', '9999999999999.999999', '9007199254740.123456'])
      await insert(value)
    for (const value of ['1.0000001', '0', '1e2'])
      await assert.rejects(insert(value), /invalid_contract/)
    assert.deepEqual(
      (await db.pool.query('SELECT value FROM fixture_quantity ORDER BY value')).rows.map(
        (row) => row.value,
      ),
      ['0.000001', '9007199254740.123456', '9999999999999.999999'],
    )
    const vector = JSON.parse(
      await readFile(
        new URL('../../../contracts/vectors/canonical-v1.json', import.meta.url),
        'utf8',
      ),
    )
    const bytes = Buffer.from(canonical(vector.input))
    assert.equal(bytes.toString('hex'), vector.utf8_hex)
    assert.equal(sha256(bytes).toString('hex'), vector.sha256)
    await db.pool.query('CREATE TABLE fixture_bytes(value bytea NOT NULL, digest bytea NOT NULL)')
    await db.pool.query('INSERT INTO fixture_bytes VALUES ($1,$2)', [bytes, sha256(bytes)])
    const row = (await db.pool.query('SELECT value,digest FROM fixture_bytes')).rows[0]
    assert(row.value.equals(bytes))
    verifyBytes(row.value, row.digest)
  } finally {
    await db.dispose()
  }
})
