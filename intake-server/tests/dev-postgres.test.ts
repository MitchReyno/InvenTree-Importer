import assert from 'node:assert/strict'
import { test } from 'node:test'
import pg from 'pg'
import { developmentAdminUrl, developmentRuntimeUrl } from '#/dev/postgres-url.ts'

test('development PostgreSQL accepts generated loopback configuration and normalizes explicit localhost administration', () => {
  assert.equal(
    developmentAdminUrl('postgresql://postgres:synthetic@localhost:5432/postgres').hostname,
    '127.0.0.1',
  )
  const address = 'postgresql://intake_owned:synthetic@127.0.0.1:55432/intake_dev_owned'
  assert.equal(developmentRuntimeUrl(address, 'intake_dev_owned').username, 'intake_owned')
})

test('development PostgreSQL refuses effective-driver host/user/query overrides before any connection', () => {
  const runtime = 'postgresql://intake_owned:synthetic@127.0.0.1:55432/intake_dev_owned'
  const admin = 'postgresql://postgres:synthetic@127.0.0.1:55432/postgres'
  const override = '?host=example.invalid&user=postgres'
  const parsed = new pg.Client({ connectionString: runtime + override })
  assert.equal(parsed.host, 'example.invalid')
  assert.equal(parsed.user, 'postgres')
  for (const suffix of [
    override,
    '?port=1',
    '?options=--search_path%3Dpublic',
    '?sslmode=disable',
    '#fragment',
  ]) {
    assert.throws(
      () => developmentAdminUrl(admin + suffix),
      /plain_development_postgres_url_required/,
    )
    assert.throws(
      () => developmentRuntimeUrl(runtime + suffix, 'intake_dev_owned'),
      /plain_development_postgres_url_required/,
    )
  }
  for (const address of [
    'postgresql://postgres@example.invalid/postgres',
    'postgresql://postgres@127.0.0.1/other',
    'https://127.0.0.1/postgres',
  ]) {
    assert.throws(() => developmentAdminUrl(address))
  }
  for (const address of [
    'postgresql://intake_owned@example.invalid/intake_dev_owned',
    'postgresql://postgres@127.0.0.1/intake_dev_owned',
    'postgresql://intake_owned@127.0.0.1/other',
  ]) {
    assert.throws(() => developmentRuntimeUrl(address, 'intake_dev_owned'))
  }
})
