import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Pool } from 'pg'
import { processingFixture, type ProcessingFixtureAllocation } from '../support/processing.ts'
import { ProcessingFixtureHttpError } from '../support/processing-http.ts'

async function allocationExists(audit: Pool, allocation: ProcessingFixtureAllocation) {
  const databases = await audit.query('SELECT datname FROM pg_database WHERE datname=$1', [
    allocation.databaseName,
  ])
  const roles = await audit.query<{ rolname: string }>(
    'SELECT rolname FROM pg_roles WHERE rolname=ANY($1::text[]) ORDER BY rolname',
    [allocation.roleNames],
  )
  return {
    database: databases.rowCount === 1,
    roles: roles.rows.map((role) => role.rolname).sort(),
  }
}

test('pre-return failures dispose only the exact allocated fixture DB, roles and listener and preserve the original error', async () => {
  const audit = new Pool({ connectionString: process.env.INTAKE_TEST_ADMIN_URL, max: 1 })
  let sentinelAllocation: ProcessingFixtureAllocation | undefined
  const sentinel = await processingFixture({
    onAllocation: (allocation) => {
      sentinelAllocation = allocation
    },
  })
  try {
    assert.ok(sentinelAllocation)
    const sentinelBefore = await allocationExists(audit, sentinelAllocation)
    assert.deepEqual(sentinelBefore, {
      database: true,
      roles: [...sentinelAllocation.roleNames].sort(),
    })

    const earlyFailure = new Error('synthetic_role_allocation_failure')
    let earlyAllocation: ProcessingFixtureAllocation | undefined
    await assert.rejects(
      () =>
        processingFixture({
          onAllocation: (allocation) => {
            earlyAllocation = allocation
            if (allocation.roleNames.length === 1) {
              throw earlyFailure
            }
          },
        }),
      (error: unknown) => error === earlyFailure,
    )
    assert.ok(earlyAllocation)
    assert.equal(earlyAllocation.roleNames.length, 1)
    assert.notEqual(earlyAllocation.databaseName, sentinelAllocation.databaseName)
    assert.deepEqual(await allocationExists(audit, earlyAllocation), { database: false, roles: [] })

    let bootstrapAllocation: ProcessingFixtureAllocation | undefined
    await assert.rejects(
      () =>
        processingFixture({
          bootstrapFault: 'close_socket',
          onAllocation: (allocation) => {
            bootstrapAllocation = allocation
          },
        }),
      (error: unknown) => {
        assert.ok(error instanceof ProcessingFixtureHttpError)
        assert.equal(error.path, '/bootstrap')
        assert.equal(error.phase, 'request')
        assert.ok(error.cause instanceof TypeError)
        return true
      },
    )
    assert.ok(bootstrapAllocation?.origin)
    assert.equal(bootstrapAllocation.roleNames.length, 3)
    assert.notEqual(bootstrapAllocation.databaseName, sentinelAllocation.databaseName)
    assert.deepEqual(await allocationExists(audit, bootstrapAllocation), {
      database: false,
      roles: [],
    })
    const closedOrigin = bootstrapAllocation.origin
    await assert.rejects(() =>
      fetch(`${closedOrigin}/api/v1/health`, { signal: AbortSignal.timeout(1000) }),
    )

    // The negative control is another live allocation, not a prefix scan or guessed orphan name.
    assert.deepEqual(await allocationExists(audit, sentinelAllocation), sentinelBefore)
    assert.equal((await sentinel.http('/health')).status, 200)
  } finally {
    await sentinel.dispose()
    await audit.end()
  }
})
