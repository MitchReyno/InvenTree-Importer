import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  copyFileSync,
  chmodSync,
  rmSync,
  statSync,
  existsSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const directoryOfTest = fileURLToPath(new URL('.', import.meta.url))
const owned = { 'bench-intake.owner': 'inventree-dev' }
const legacy = {
  Names: 'bench-intake-dev-pg',
  Image: 'postgres:17',
  Status: 'Up 4 days',
  Ports: '127.0.0.1:55432->5432/tcp',
}
const serverState = {
  version: 1,
  server_id: 'd'.repeat(32),
  admin: 'a'.repeat(48),
  migrator: 'b'.repeat(48),
  app: 'c'.repeat(48),
}

function ownedInspect(overrides: Record<string, unknown> = {}) {
  return {
    Config: {
      Labels: owned,
      Image: 'postgres:17',
      Cmd: ['postgres', '-c', 'max_connections=120', '-c', 'shared_buffers=64MB'],
    },
    HostConfig: {
      PortBindings: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '55433' }] },
      Memory: 536870912,
      NanoCpus: 1000000000,
      PidsLimit: 256,
      RestartPolicy: { Name: 'no' },
      ...overrides,
    },
    Mounts: [
      { Type: 'volume', Name: 'bench-inventree-dev-db', Destination: '/var/lib/postgresql/data' },
    ],
  }
}

function harness() {
  const root = mkdtempSync(resolve(tmpdir(), 'intake-tooling-'))
  const directory = resolve(root, 'private')
  mkdirSync(directory, { mode: 0o700 })
  const fakeDocker = resolve(root, 'docker.ts')
  const calls = resolve(root, 'calls.jsonl')
  const scenarioFile = resolve(root, 'scenario.json')
  copyFileSync(resolve(directoryOfTest, 'fixtures/docker.ts'), fakeDocker)
  chmodSync(fakeDocker, 0o700)
  const legacyState = JSON.stringify({ admin: 'e'.repeat(48), migrator: 'f'.repeat(48) })
  writeFileSync(resolve(directory, 'postgres.json'), legacyState, { mode: 0o600 })
  const invoke = (
    scenario: Record<string, unknown>,
    { action = 'start', env = { INTAKE_DEV_STATE: directory } as Record<string, string> } = {},
  ) => {
    writeFileSync(scenarioFile, JSON.stringify(scenario))
    writeFileSync(calls, '')
    return spawnSync(
      process.execPath,
      [resolve(directoryOfTest, '../scripts/dev-services.cjs'), action],
      {
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH,
          DOCKER_BIN: fakeDocker,
          INTAKE_ENV_FILE: '',
          INTAKE_FIXTURE_CALLS: calls,
          INTAKE_FIXTURE_SCENARIO: scenarioFile,
          ...env,
        },
        timeout: 20000,
      },
    )
  }
  const recorded = () =>
    readFileSync(calls, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as string[])
  const readOnly = () =>
    recorded().every(
      (call) =>
        ['ps', 'inspect', 'volume'].includes(call[0]) ||
        (call[0] === 'compose' && call.includes('ls')),
    )
  return { root, directory, invoke, recorded, readOnly, legacyState }
}

test('a first start creates private server state and starts only the shared inventree-db service', () => {
  const h = harness()
  try {
    const result = h.invoke({ containers: [legacy], volumes: [] })
    const compose = h.recorded().filter((call) => call[0] === 'compose' && call.includes('up'))
    assert.equal(compose.length, 1, result.stderr)
    const up = compose[0]
    assert.deepEqual(up.slice(up.indexOf('-p')), [
      '-p',
      'bench-inventree-dev',
      'up',
      '-d',
      '--no-recreate',
      '--wait',
      'inventree-db',
    ])
    assert(up[up.indexOf('-f') + 1].endsWith('tooling/inventree-dev/compose.yaml'))
    assert(
      h.recorded().every((call) => !call.includes('run') && !call.includes('bench-intake-dev-pg')),
      'the legacy container is never created, started or inspected',
    )
    const json = resolve(h.directory, 'inventree-db.json')
    const env = resolve(h.directory, 'inventree-db.env')
    assert.equal(statSync(json).mode & 0o777, 0o600)
    assert.equal(statSync(env).mode & 0o777, 0o600)
    const created = JSON.parse(readFileSync(json, 'utf8'))
    assert.match(created.server_id, /^[a-f0-9]{32}$/)
    assert.equal(readFileSync(env, 'utf8'), `POSTGRES_PASSWORD=${created.admin}\n`)
    assert.equal(readFileSync(resolve(h.directory, 'postgres.json'), 'utf8'), h.legacyState)
    for (const secret of [created.admin, created.migrator, created.app]) {
      assert(!JSON.stringify(h.recorded()).includes(secret), 'no secret in docker argv')
      assert(!(result.stdout + result.stderr).includes(secret), 'no secret in output')
    }
  } finally {
    rmSync(h.root, { recursive: true })
  }
})

test('a second checkout starts the existing owned server without recreating it', () => {
  const h = harness()
  try {
    writeFileSync(resolve(h.directory, 'inventree-db.json'), JSON.stringify(serverState), {
      mode: 0o600,
    })
    h.invoke({
      containers: [
        legacy,
        { Names: 'bench-inventree-dev-db', Image: 'postgres:17', Status: 'Exited (0)', Ports: '' },
      ],
      volumes: [{ Name: 'bench-inventree-dev-db', Labels: 'bench-intake.owner=inventree-dev' }],
      inspect: { 'bench-inventree-dev-db': ownedInspect() },
    })
    const up = h.recorded().filter((call) => call[0] === 'compose' && call.includes('up'))
    assert.equal(up.length, 1)
    assert(up[0].includes('--no-recreate'))
    assert(!h.recorded().some((call) => call.includes('--force-recreate') || call.includes('rm')))
    assert.equal(
      readFileSync(resolve(h.directory, 'inventree-db.env'), 'utf8'),
      `POSTGRES_PASSWORD=${serverState.admin}\n`,
    )
    const kept = JSON.parse(readFileSync(resolve(h.directory, 'inventree-db.json'), 'utf8'))
    assert.equal(kept.server_id, serverState.server_id, 'an existing server keeps its identity')
  } finally {
    rmSync(h.root, { recursive: true })
  }
})

test('refusals issue only read-only Docker operations and never regenerate state', () => {
  const h = harness()
  try {
    const cases: [Record<string, unknown>, RegExp, boolean][] = [
      [
        {
          volumes: [{ Name: 'bench-inventree-dev-db', Labels: 'bench-intake.owner=inventree-dev' }],
        },
        /inventree_db_state_missing_for_existing_volume/,
        false,
      ],
      [
        {
          containers: [{ Names: 'bench-inventree-dev-db', Image: 'postgres:17', Status: 'Up' }],
          inspect: { 'bench-inventree-dev-db': { ...ownedInspect(), Config: { Labels: {} } } },
        },
        /service_not_owned/,
        true,
      ],
      [{ volumes: [{ Name: 'bench-inventree-dev-db', Labels: '' }] }, /service_not_owned/, true],
      [
        {
          containers: [
            {
              Names: 'someone-else',
              Image: 'postgres:16',
              Status: 'Up',
              Ports: '127.0.0.1:55433->5432/tcp',
            },
          ],
        },
        /service_port_not_owned/,
        true,
      ],
      [
        {
          containers: [{ Names: 'bench-inventree-dev-db', Image: 'postgres:17', Status: 'Up' }],
          volumes: [{ Name: 'bench-inventree-dev-db', Labels: 'bench-intake.owner=inventree-dev' }],
          inspect: { 'bench-inventree-dev-db': ownedInspect({ PidsLimit: 128 }) },
        },
        /owned_service_allocation_changed_request_coordinator/,
        true,
      ],
    ]
    for (const [scenario, refusal, withState] of cases) {
      const json = resolve(h.directory, 'inventree-db.json')
      rmSync(json, { force: true })
      if (withState) writeFileSync(json, JSON.stringify(serverState), { mode: 0o600 })
      const result = h.invoke(scenario)
      assert.equal(result.status, 1)
      assert.match(result.stderr, refusal)
      assert(h.readOnly(), `${refusal} must not mutate Docker`)
      assert.equal(existsSync(json), withState, `${refusal} must not create state`)
    }
    const json = resolve(h.directory, 'inventree-db.json')
    chmodSync(json, 0o644)
    const unsafe = h.invoke({})
    assert.equal(unsafe.status, 1)
    assert.match(unsafe.stderr, /invalid_owned_service_state/)
    assert(h.readOnly())
    assert.equal(readFileSync(json, 'utf8'), JSON.stringify(serverState))
    assert.equal(readFileSync(resolve(h.directory, 'postgres.json'), 'utf8'), h.legacyState)
  } finally {
    rmSync(h.root, { recursive: true })
  }
})

test('the state directory can come from the selected env file, as for pnpm dev', () => {
  const h = harness()
  try {
    const envFile = resolve(h.root, 'outside.env')
    writeFileSync(envFile, `INTAKE_DEV_STATE=${h.directory}\n`)
    h.invoke({}, { env: { INTAKE_ENV_FILE: envFile } })
    assert(existsSync(resolve(h.directory, 'inventree-db.json')))
  } finally {
    rmSync(h.root, { recursive: true })
  }
})

test('identity reads the server ID without Docker and never creates state', () => {
  const h = harness()
  try {
    const missing = h.invoke({}, { action: 'identity' })
    assert.equal(missing.status, 1)
    assert.match(missing.stderr, /inventree_db_state_missing_run_dev_services/)
    assert.equal(existsSync(resolve(h.directory, 'inventree-db.json')), false)
    writeFileSync(resolve(h.directory, 'inventree-db.json'), JSON.stringify(serverState), {
      mode: 0o600,
    })
    const found = h.invoke({}, { action: 'identity' })
    assert.equal(found.status, 0, found.stderr)
    assert.equal(found.stdout.trim(), serverState.server_id)
    assert.equal(h.recorded().length, 0)
  } finally {
    rmSync(h.root, { recursive: true })
  }
})

test('a server re-created under existing state gets a new identity and keeps its secrets', () => {
  const h = harness()
  try {
    writeFileSync(resolve(h.directory, 'inventree-db.json'), JSON.stringify(serverState), {
      mode: 0o600,
    })
    h.invoke({ containers: [legacy], volumes: [] })
    const renewed = JSON.parse(readFileSync(resolve(h.directory, 'inventree-db.json'), 'utf8'))
    assert.match(renewed.server_id, /^[a-f0-9]{32}$/)
    assert.notEqual(renewed.server_id, serverState.server_id)
    assert.deepEqual({ ...renewed, server_id: serverState.server_id }, serverState)
    assert.equal(statSync(resolve(h.directory, 'inventree-db.json')).mode & 0o777, 0o600)
  } finally {
    rmSync(h.root, { recursive: true })
  }
})
