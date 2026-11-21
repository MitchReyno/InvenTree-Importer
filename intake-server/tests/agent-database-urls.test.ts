import { test } from 'node:test'
import assert from 'node:assert/strict'
import { localDatabaseUrl, schedulerDatabaseUrl } from '#/agents/session/database-urls.ts'

test('scheduler URLs that DBOS and pg read the same way are accepted', () => {
  for (const url of [
    'postgres://bench@127.0.0.1:5432/intake_0a1b',
    'postgres://bench@localhost/scheduler.demo',
    'postgres://bench@[::1]/scheduler%20demo',
  ]) {
    assert.equal(schedulerDatabaseUrl(url), url)
  }
})

test('scheduler URLs DBOS would reject or read differently are refused', () => {
  for (const url of [
    'postgres://127.0.0.1/dbos',
    'postgres://bench@127.0.0.1/',
    `postgres://bench@127.0.0.1/${'s'.repeat(64)}`,
    'postgres://bench@127.0.0.1/a%E2',
  ]) {
    assert.throws(() => schedulerDatabaseUrl(url), /local_agent_database_required/, url)
  }
})

test('agent database URLs must name a loopback server without overrides or NULs', () => {
  assert.throws(() => localDatabaseUrl(undefined), /agent_database_required/)
  for (const url of [
    'postgres://bench@192.0.2.1/db',
    'postgres://bench@127.0.0.1/db?host=192.0.2.10',
    'postgres://bench@127.0.0.1/db?hostaddr=192.0.2.10',
    'postgres://bench@%2Ffixture/db?host=127.0.0.1',
    'postgres://bench@127.0.0.1/db?port=65536',
    'postgres://bench@127.0.0.1/db?application_name=a%00b',
    'mysql://bench@127.0.0.1/db',
  ]) {
    assert.throws(() => localDatabaseUrl(url), /local_agent_database_required/, url)
  }
})
