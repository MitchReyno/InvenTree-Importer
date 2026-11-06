import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PG, developmentAdmin, readServerState, serverIdentity } from '../src/dev/pg-identity.ts'
import { developmentStateRoot } from '../src/dev/target.ts'
import { assertStateServer } from '../src/dev/state.ts'

const state = {
  version: 1,
  server_id: 'd'.repeat(32),
  admin: 'a'.repeat(48),
  migrator: 'b'.repeat(48),
  app: 'c'.repeat(48),
}

function privateDirectory() {
  const root = mkdtempSync(join(tmpdir(), 'pg-identity-'))
  const directory = join(root, 'state')
  mkdirSync(directory, { mode: 0o700 })
  return { root, directory }
}

test('the shared server is the loopback inventree-db service on its own port', () => {
  assert.equal(PG.host, '127.0.0.1')
  assert.equal(PG.port, 55433)
  assert.equal(PG.project, 'bench-inventree-dev')
  assert.equal(PG.service, 'inventree-db')
  assert.equal(PG.container, 'bench-inventree-dev-db')
})

test('admin access comes from inventree-db.json, never the legacy postgres.json', async () => {
  const { root, directory } = privateDirectory()
  try {
    writeFileSync(join(directory, 'postgres.json'), JSON.stringify({ admin: 'e'.repeat(48) }), {
      mode: 0o600,
    })
    await assert.rejects(
      developmentAdmin({ INTAKE_DEV_STATE: directory }),
      /inventree_db_state_missing/,
    )
    writeFileSync(join(directory, 'inventree-db.json'), JSON.stringify(state), { mode: 0o600 })
    const url = await developmentAdmin({ INTAKE_DEV_STATE: directory })
    assert.equal(url.hostname, '127.0.0.1')
    assert.equal(url.port, '55433')
    assert.equal(url.pathname, '/postgres')
    assert.equal(url.password, state.admin)
    assert.equal(await serverIdentity({ INTAKE_DEV_STATE: directory }), state.server_id)
  } finally {
    rmSync(root, { recursive: true })
  }
})

test('unsafe or malformed server state is refused without echoing secrets', async () => {
  const { root, directory } = privateDirectory()
  try {
    const file = join(directory, 'inventree-db.json')
    writeFileSync(file, JSON.stringify(state), { mode: 0o644 })
    await assert.rejects(
      readServerState({ INTAKE_DEV_STATE: directory }),
      /private_owned_state_required/,
    )
    rmSync(file)
    writeFileSync(file, JSON.stringify({ ...state, admin: 'short' }), { mode: 0o600 })
    await assert.rejects(readServerState({ INTAKE_DEV_STATE: directory }), (error) => {
      assert.match(String(error), /invalid_owned_service_state/)
      assert.equal(String(error).includes(state.migrator), false)
      return true
    })
  } finally {
    rmSync(root, { recursive: true })
  }
})

test('an explicit admin URL identifies its server by host and port, not its secret', async () => {
  const one = await serverIdentity({
    INTAKE_DEV_ADMIN_URL: 'postgresql://postgres:first@127.0.0.1:6543/postgres',
  })
  const rotated = await serverIdentity({
    INTAKE_DEV_ADMIN_URL: 'postgresql://postgres:second@127.0.0.1:6543/postgres',
  })
  const other = await serverIdentity({
    INTAKE_DEV_ADMIN_URL: 'postgresql://postgres:first@127.0.0.1:6544/postgres',
  })
  assert.match(one, /^[a-f0-9]{32}$/)
  assert.equal(one, rotated)
  assert.notEqual(one, other)
})

test('default namespaces are scoped to the database server', () => {
  const fake = developmentStateRoot({}, { kind: 'fake' }, { serverId: state.server_id })
  assert.match(fake, /\/\.local\/state\/bench-intake\/app-[a-f0-9]{16}$/)
  assert.notEqual(fake, developmentStateRoot({}, { kind: 'fake' }, { serverId: 'e'.repeat(32) }))
  const target = {
    kind: 'read-only' as const,
    origin: 'https://inventory.example.invalid',
    credentialRef: 'synthetic',
  }
  assert.notEqual(
    developmentStateRoot({}, target, { serverId: state.server_id }),
    developmentStateRoot({}, target, { serverId: 'e'.repeat(32) }),
  )
  assert.equal(
    developmentStateRoot({ INTAKE_APP_STATE: '/explicit' }, target, { serverId: state.server_id }),
    '/explicit',
  )
})

test('app state bound to another server, or to none, is refused', () => {
  assert.doesNotThrow(() => assertStateServer({ serverId: state.server_id }, state.server_id))
  assert.throws(
    () => assertStateServer({ serverId: 'e'.repeat(32) }, state.server_id),
    /development_state_server_changed/,
  )
  assert.throws(() => assertStateServer({}, state.server_id), /development_state_server_changed/)
})
