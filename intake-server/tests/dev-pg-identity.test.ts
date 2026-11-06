import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ALLOCATION,
  PG,
  composeFile,
  developmentAdmin,
  readServerState,
  serverIdentity,
  sharedServerAdmin,
} from '../src/dev/pg-identity.ts'
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

test('the inventree-dev CLI always uses the shared server, never an explicit admin URL', async () => {
  const { root, directory } = privateDirectory()
  try {
    writeFileSync(join(directory, 'inventree-db.json'), JSON.stringify(state), { mode: 0o600 })
    const url = await sharedServerAdmin({
      INTAKE_DEV_STATE: directory,
      INTAKE_DEV_ADMIN_URL: 'postgresql://postgres:external@127.0.0.1:6543/postgres',
    })
    assert.equal(url.port, '55433')
    assert.equal(url.password, state.admin)
  } finally {
    rmSync(root, { recursive: true })
  }
})

test('the drift check matches the inventree-db definition in compose.yaml', () => {
  const compose = readFileSync(composeFile(), 'utf8')
  const service = compose.slice(
    compose.indexOf('  inventree-db:'),
    compose.indexOf('  inventree-init:'),
  )
  assert.match(service, new RegExp(`image: ${ALLOCATION.image}\\n`))
  assert.match(service, new RegExp(`container_name: ${PG.container}\\n`))
  assert(service.includes(`command: ${JSON.stringify(ALLOCATION.command).replaceAll(',', ', ')}`))
  assert.match(service, new RegExp(`- ${PG.host}:${PG.port}:5432\\n`))
  assert.match(service, new RegExp(`- ${PG.volume}:/var/lib/postgresql/data\\n`))
  assert.match(service, /restart: "no"\n/)
  assert.equal(Number(service.match(/cpus: (\d+)/)?.[1]) * 1e9, ALLOCATION.nanoCpus)
  assert.equal(Number(service.match(/mem_limit: (\d+)m/)?.[1]) * 1024 * 1024, ALLOCATION.memory)
  assert.equal(Number(service.match(/pids_limit: (\d+)/)?.[1]), ALLOCATION.pids)
  assert.match(service, new RegExp(`${PG.ownerLabel}: ${PG.owner}\\n`))
})
