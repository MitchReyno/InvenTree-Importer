const test = require('node:test')
const assert = require('node:assert/strict')
const {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  stat,
  rm,
  access,
} = require('node:fs/promises')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const lib = require('../inventree-dev/lib.cjs')

const COMPOSE_DIR = join(__dirname, '../inventree-dev')
const serverState = {
  version: 1,
  server_id: 'd'.repeat(32),
  admin: 'a'.repeat(48),
  migrator: 'b'.repeat(48),
  app: 'c'.repeat(48),
}
const validState = {
  version: 1,
  instance_id: 'e'.repeat(32),
  image:
    'inventree/inventree@sha256:36027b18ac12e428d0adeda1428325a79c915d571f9c22e2efa0d736f68a3d53',
  db_password: '1'.repeat(48),
  secret_key: '2'.repeat(64),
  admin_password: '3'.repeat(24),
  initialized: true,
  tokens: null,
}
const tokens = {
  reader: `inv-${'r'.repeat(40)}-20261106`,
  writer: `inv-${'w'.repeat(40)}-20261106`,
}

async function harness(options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'inventree-dev-'))
  const stateDir = join(root, 'state')
  await mkdir(stateDir, { mode: 0o700 })
  await writeFile(join(stateDir, 'inventree-db.json'), JSON.stringify(serverState), { mode: 0o600 })
  await writeFile(join(stateDir, 'postgres.json'), '{"admin":"legacy"}', { mode: 0o600 })
  const calls = []
  const seen = []
  const queries = []
  const log = []
  const containers = options.containers ?? []
  const volumes = options.volumes ?? [
    { Name: 'bench-inventree-dev-db', Labels: 'bench-intake.owner=inventree-dev' },
  ]
  const ctx = {
    env: { INTAKE_DEV_STATE: stateDir, ...options.env },
    stateDir,
    home: join(root, 'home'),
    composeDir: COMPOSE_DIR,
    log: (line) => log.push(line),
    startServices: async () => calls.push(['start-services']),
    query: async (text) => {
      queries.push(text)
      return { rowCount: 0, rows: [] }
    },
    seed: async () => calls.push(['seed']),
    docker: async (args, dockerOptions) => {
      calls.push(args)
      seen.push({ args, options: dockerOptions })
      if (args[0] === 'ps') {
        return { status: 0, stdout: containers.map((row) => JSON.stringify(row)).join('\n') }
      }
      if (args[0] === 'volume' && args[1] === 'ls') {
        return { status: 0, stdout: volumes.map((row) => JSON.stringify(row)).join('\n') }
      }
      const sub = lib.composeSubcommand(args)
      if (options.fail?.includes(sub)) {
        return { status: 1, stdout: '', stderr: 'failed' }
      }
      if (sub === 'cp') {
        await writeFile(args[args.length - 1], JSON.stringify(tokens), { mode: 0o600 })
      }
      if (sub === 'logs') {
        return { status: 0, stdout: `boom with ${options.leak ?? 'nothing'}\n` }
      }
      return { status: 0, stdout: '' }
    },
  }
  return { root, stateDir, ctx, calls, seen, queries, log }
}

const composeCalls = (calls) =>
  calls.filter((call) => call[0] === 'compose').map((call) => call.slice(call.indexOf('-p') + 2))

test('up starts the database first, then readies InvenTree with init run and removed before the server', async () => {
  const h = await harness()
  try {
    await lib.up(h.ctx)
    assert.deepEqual(h.calls[0], ['start-services'])
    const compose = composeCalls(h.calls)
    const index = (needle) =>
      compose.findIndex((call) => JSON.stringify(call) === JSON.stringify(needle))
    const initRun = index([
      'up',
      '--no-deps',
      '--exit-code-from',
      'inventree-init',
      'inventree-init',
    ])
    const copy = compose.findIndex((call) => call[0] === 'cp')
    const removeAfter = compose.findLastIndex(
      (call) => JSON.stringify(call) === JSON.stringify(['rm', '-fsv', 'inventree-init']),
    )
    const server = index([
      'up',
      '-d',
      '--no-deps',
      '--wait',
      '--wait-timeout',
      '60',
      'inventree-server',
      'inventree-worker',
    ])
    assert(
      initRun > -1 && copy > initRun && removeAfter > copy && server > removeAfter,
      JSON.stringify(compose),
    )
    assert(
      h.calls.findIndex((call) => call[0] === 'seed') >
        h.calls.findIndex((call) => call.includes('inventree-server')),
    )
    assert(
      h.queries.some((sql) =>
        /CREATE ROLE inventree LOGIN PASSWORD '[a-f0-9]{48}' .*CONNECTION LIMIT 20/.test(sql),
      ),
    )
    assert(h.queries.some((sql) => /CREATE DATABASE inventree OWNER inventree/.test(sql)))
    assert(h.queries.some((sql) => /REVOKE CONNECT ON DATABASE inventree FROM PUBLIC/.test(sql)))
    const state = JSON.parse(await readFile(join(h.stateDir, 'inventree-dev.json'), 'utf8'))
    assert.deepEqual(state.tokens, tokens)
    assert.match(state.instance_id, /^[a-f0-9]{32}$/)
    for (const file of ['inventree-dev.json', 'inventree.env', 'inventree-init.env']) {
      assert.equal((await stat(join(h.stateDir, file))).mode & 0o777, 0o600, file)
    }
    const serverEnv = await readFile(join(h.stateDir, 'inventree.env'), 'utf8')
    assert(!serverEnv.includes(state.admin_password) && !serverEnv.includes(tokens.writer))
    assert.match(serverEnv, /INVENTREE_SECRET_KEY=/)
    const argv = JSON.stringify(h.calls)
    for (const secret of [
      state.admin_password,
      state.db_password,
      state.secret_key,
      tokens.reader,
      tokens.writer,
      serverState.admin,
    ]) {
      assert(!argv.includes(secret), 'no secret in docker argv')
      assert(!h.log.join('\n').includes(secret), 'no secret in output')
    }
    assert(!(await readdir(h.stateDir)).some((name) => name.startsWith('handoff-')))
  } finally {
    await rm(h.root, { recursive: true })
  }
})

test('a second up passes the stored tokens to init only, and reuses the instance', async () => {
  const h = await harness()
  try {
    await lib.up(h.ctx)
    const first = JSON.parse(await readFile(join(h.stateDir, 'inventree-dev.json'), 'utf8'))
    await lib.up(h.ctx)
    const second = JSON.parse(await readFile(join(h.stateDir, 'inventree-dev.json'), 'utf8'))
    assert.equal(second.instance_id, first.instance_id)
    const init = await readFile(join(h.stateDir, 'inventree-init.env'), 'utf8')
    assert.match(init, new RegExp(`BENCH_INTAKE_READER_TOKEN=${tokens.reader}`))
    assert.match(init, new RegExp(`BENCH_INTAKE_WRITER_TOKEN=${tokens.writer}`))
    assert(
      h.queries.some((sql) => /ALTER ROLE inventree LOGIN PASSWORD/.test(sql)) ||
        h.queries.length > 0,
    )
  } finally {
    await rm(h.root, { recursive: true })
  }
})

test('a failed init is still removed and its log tail is redacted', async () => {
  const h = await harness({ fail: ['up-init'], leak: 'PLACEHOLDER' })
  try {
    await lib.ensureState(h.ctx)
    const state = JSON.parse(await readFile(join(h.stateDir, 'inventree-dev.json'), 'utf8'))
    h.ctx.docker = ((inner) => async (args) => {
      if (lib.composeSubcommand(args) === 'logs') {
        h.calls.push(args)
        return { status: 0, stdout: `failed with ${state.admin_password}\n` }
      }
      return inner(args)
    })(h.ctx.docker)
    await assert.rejects(lib.up(h.ctx), /inventree_init_failed/)
    const compose = composeCalls(h.calls)
    assert.deepEqual(compose[compose.length - 1], ['rm', '-fsv', 'inventree-init'])
    assert(
      !compose.some((call) => call.includes('inventree-server')),
      'server not started after failed init',
    )
    const output = h.log.join('\n')
    assert(output.includes('[redacted]'))
    assert(!output.includes(state.admin_password))
  } finally {
    await rm(h.root, { recursive: true })
  }
})

test('another checkout owning the InvenTree services is refused before any change', async () => {
  const h = await harness({
    containers: [
      {
        Names: 'bench-inventree-dev-inventree-server-1',
        Labels:
          'com.docker.compose.project=bench-inventree-dev,com.docker.compose.service=inventree-server,com.docker.compose.project.working_dir=/other/checkout/tooling/inventree-dev',
      },
      {
        Names: 'bench-inventree-dev-db',
        Labels:
          'com.docker.compose.project=bench-inventree-dev,com.docker.compose.service=inventree-db,com.docker.compose.project.working_dir=/third/checkout/tooling/inventree-dev',
      },
    ],
  })
  try {
    await assert.rejects(lib.up(h.ctx), /inventree_dev_owned_by_other_checkout/)
    assert(!h.calls.some((call) => call[0] === 'compose'))
    await assert.rejects(access(join(h.stateDir, 'inventree-dev.json')))
  } finally {
    await rm(h.root, { recursive: true })
  }
})

test('the shared database may belong to another checkout', async () => {
  const h = await harness({
    containers: [
      {
        Names: 'bench-inventree-dev-db',
        Labels:
          'com.docker.compose.project=bench-inventree-dev,com.docker.compose.service=inventree-db,com.docker.compose.project.working_dir=/third/checkout/tooling/inventree-dev',
      },
    ],
  })
  try {
    await lib.up(h.ctx)
  } finally {
    await rm(h.root, { recursive: true })
  }
})

test('a held lock refuses up, seed and reset', async () => {
  const h = await harness()
  try {
    const held = JSON.stringify({ pid: process.pid, nonce: 'live-holder' })
    await writeFile(join(h.stateDir, 'inventree-dev.lock'), held, { mode: 0o600 })
    await assert.rejects(lib.up(h.ctx), /inventree_dev_lock_held/)
    await assert.rejects(lib.seedCommand(h.ctx), /inventree_dev_lock_held/)
    await assert.rejects(lib.reset(h.ctx, { yes: true }), /inventree_dev_lock_held/)
    assert.equal(h.calls.length, 0)
    assert.equal(await readFile(join(h.stateDir, 'inventree-dev.lock'), 'utf8'), held)
  } finally {
    await rm(h.root, { recursive: true })
  }
})

test('unsafe state and a data volume without state are refused', async () => {
  const h = await harness({
    volumes: [
      { Name: 'bench-inventree-dev-db', Labels: 'bench-intake.owner=inventree-dev' },
      { Name: 'bench-inventree-dev-data', Labels: 'bench-intake.owner=inventree-dev' },
    ],
  })
  try {
    await assert.rejects(lib.up(h.ctx), /inventree_dev_state_missing_for_existing_volume/)
    await writeFile(join(h.stateDir, 'inventree-dev.json'), '{}', { mode: 0o644 })
    await assert.rejects(lib.up(h.ctx), /private_owned_state_required/)
  } finally {
    await rm(h.root, { recursive: true })
  }
})

test('reset needs --yes and by default resets InvenTree only, in order', async () => {
  const h = await harness({
    volumes: [
      { Name: 'bench-inventree-dev-db', Labels: 'bench-intake.owner=inventree-dev' },
      { Name: 'bench-inventree-dev-data', Labels: 'bench-intake.owner=inventree-dev' },
    ],
  })
  try {
    await assert.rejects(lib.reset(h.ctx, {}), /reset_requires_yes/)
    assert.equal(h.calls.length, 0)
    await writeFile(join(h.stateDir, 'inventree-dev.json'), JSON.stringify(validState), {
      mode: 0o600,
    })
    await lib.reset(h.ctx, { yes: true, restart: false })
    const stopAt = h.calls.findIndex(
      (call) => call[0] === 'compose' && call.includes('rm') && call.includes('inventree-server'),
    )
    assert(stopAt > -1)
    const stopped = h.calls[stopAt]
    assert(stopped.includes('inventree-worker') && stopped.includes('inventree-init'))
    assert(!stopped.includes('inventree-db'))
    assert(
      h.queries.findIndex((sql) => /DROP DATABASE IF EXISTS inventree WITH \(FORCE\)/.test(sql)) >
        -1,
    )
    assert(h.queries.some((sql) => /DROP ROLE IF EXISTS inventree/.test(sql)))
    const removed = h.calls.filter((call) => call[0] === 'volume' && call[1] === 'rm')
    assert.deepEqual(removed, [['volume', 'rm', 'bench-inventree-dev-data']])
    for (const file of ['inventree-dev.json', 'inventree.env', 'inventree-init.env']) {
      await assert.rejects(access(join(h.stateDir, file)), undefined, file)
    }
    await access(join(h.stateDir, 'inventree-db.json'))
    assert.equal(await readFile(join(h.stateDir, 'postgres.json'), 'utf8'), '{"admin":"legacy"}')
  } finally {
    await rm(h.root, { recursive: true })
  }
})

test('reset --database-server refuses while an app may use it, otherwise removes the server too', async () => {
  const h = await harness({
    volumes: [
      { Name: 'bench-inventree-dev-db', Labels: 'bench-intake.owner=inventree-dev' },
      { Name: 'bench-inventree-dev-data', Labels: 'bench-intake.owner=inventree-dev' },
    ],
  })
  try {
    const app = join(h.ctx.home, '.local/state/bench-intake/app-0123456789abcdef')
    await mkdir(app, { recursive: true })
    await writeFile(join(app, 'supervisor.lock'), '{}')
    await assert.rejects(
      lib.reset(h.ctx, { yes: true, databaseServer: true, restart: false }),
      /reset_refused_supervisor_running/,
    )
    await rm(join(app, 'supervisor.lock'))
    await assert.rejects(
      lib.reset(
        { ...h.ctx, env: { ...h.ctx.env, INTAKE_APP_STATE: '/explicit' } },
        { yes: true, databaseServer: true, restart: false },
      ),
      /reset_refused_explicit_app_state/,
    )
    assert.equal(h.calls.length, 0)
    await lib.reset(h.ctx, { yes: true, databaseServer: true, restart: false })
    const db = h.calls.findIndex(
      (call) => call[0] === 'compose' && call.includes('rm') && call.includes('inventree-db'),
    )
    const volume = h.calls.findIndex(
      (call) => JSON.stringify(call) === '["volume","rm","bench-inventree-dev-db"]',
    )
    assert(db > -1 && volume > db, 'the server stops before its volume is removed')
    for (const file of ['inventree-db.json', 'inventree-db.env']) {
      await assert.rejects(access(join(h.stateDir, file)), undefined, file)
    }
    assert.equal(await readFile(join(h.stateDir, 'postgres.json'), 'utf8'), '{"admin":"legacy"}')
  } finally {
    await rm(h.root, { recursive: true })
  }
})

test('reset refuses an unlabelled volume with a reserved name', async () => {
  const h = await harness({
    volumes: [
      { Name: 'bench-inventree-dev-db', Labels: 'bench-intake.owner=inventree-dev' },
      { Name: 'bench-inventree-dev-data', Labels: '' },
    ],
  })
  try {
    await assert.rejects(lib.reset(h.ctx, { yes: true, restart: false }), /service_not_owned/)
    assert(!h.calls.some((call) => call[0] === 'volume' && call[1] === 'rm'))
  } finally {
    await rm(h.root, { recursive: true })
  }
})

test('the CLI pins the same image digest as the Compose file', async () => {
  const compose = await readFile(join(COMPOSE_DIR, 'compose.yaml'), 'utf8')
  assert(compose.includes(lib.IMAGE))
  assert.match(
    lib.IMAGE,
    /@sha256:36027b18ac12e428d0adeda1428325a79c915d571f9c22e2efa0d736f68a3d53$/,
  )
})

test('a state written by an older image upgrades with the first-run init timeout', async () => {
  const h = await harness()
  try {
    const older = {
      ...validState,
      image: `inventree/inventree@sha256:${'0'.repeat(64)}`,
      tokens,
    }
    await writeFile(join(h.stateDir, 'inventree-dev.json'), JSON.stringify(older), { mode: 0o600 })
    await lib.up(h.ctx)
    const init = h.seen.find(({ args }) => lib.composeSubcommand(args) === 'up-init')
    const stopOld = h.seen.findIndex(
      ({ args }) =>
        args.includes('rm') &&
        args.includes('inventree-server') &&
        args.includes('inventree-worker'),
    )
    assert(
      stopOld > -1 && stopOld < h.seen.indexOf(init),
      'the old server stops before init migrates',
    )
    assert.equal(init.options.timeoutMs, 600_000)
    const state = JSON.parse(await readFile(join(h.stateDir, 'inventree-dev.json'), 'utf8'))
    assert.equal(state.image, lib.IMAGE)
    assert.equal(state.instance_id, older.instance_id)
  } finally {
    await rm(h.root, { recursive: true })
  }
})

test('an empty lock counts as held, a dead holder is replaced, and a lock taken over is never deleted', async () => {
  const h = await harness()
  try {
    const lock = join(h.stateDir, 'inventree-dev.lock')
    await writeFile(lock, '', { mode: 0o600 })
    await assert.rejects(lib.up(h.ctx), /inventree_dev_lock_held/)
    assert.equal(h.calls.length, 0)
    await writeFile(lock, JSON.stringify({ pid: 2147483646, nonce: 'dead' }), { mode: 0o600 })
    await lib.up(h.ctx)
    await assert.rejects(access(lock), undefined, 'own lock released')
    h.ctx.seed = async () => {
      await writeFile(lock, JSON.stringify({ pid: process.pid, nonce: 'someone-else' }))
    }
    await lib.up(h.ctx)
    assert.equal(JSON.parse(await readFile(lock, 'utf8')).nonce, 'someone-else')
  } finally {
    await rm(h.root, { recursive: true })
  }
})

test('a token handoff left by an interrupted run is swept', async () => {
  const h = await harness()
  try {
    const leftover = join(h.stateDir, 'handoff-interrupted')
    await mkdir(leftover, { mode: 0o700 })
    await writeFile(join(leftover, 'tokens.json'), JSON.stringify(tokens), { mode: 0o600 })
    await lib.up(h.ctx)
    assert(!(await readdir(h.stateDir)).some((name) => name.startsWith('handoff-')))
  } finally {
    await rm(h.root, { recursive: true })
  }
})

test('a lock that changes during takeover is never removed', async () => {
  for (const stage of ['before-read', 'after-read']) {
    const h = await harness()
    try {
      const lock = join(h.stateDir, 'inventree-dev.lock')
      await writeFile(lock, JSON.stringify({ pid: 2147483646, nonce: 'dead' }), { mode: 0o600 })
      const fresh = JSON.stringify({ pid: process.pid, nonce: `fresh-${stage}` })
      h.ctx.lockRace = async (at) => {
        if (at === stage) {
          await rm(lock, { force: true })
          await writeFile(lock, fresh, { mode: 0o600 })
        }
      }
      await assert.rejects(lib.up(h.ctx), /inventree_dev_lock_held/, stage)
      assert.equal(await readFile(lock, 'utf8'), fresh, stage)
      assert.equal(h.calls.length, 0, stage)
    } finally {
      await rm(h.root, { recursive: true })
    }
  }
})

test('up refuses an unlabelled data volume even when state exists', async () => {
  const h = await harness({
    volumes: [
      { Name: 'bench-inventree-dev-db', Labels: 'bench-intake.owner=inventree-dev' },
      { Name: 'bench-inventree-dev-data', Labels: '' },
    ],
  })
  try {
    await writeFile(join(h.stateDir, 'inventree-dev.json'), JSON.stringify(validState), {
      mode: 0o600,
    })
    await assert.rejects(lib.up(h.ctx), /service_not_owned/)
    assert(!h.calls.some((call) => call[0] === 'compose'))
  } finally {
    await rm(h.root, { recursive: true })
  }
})

test('the database reset ignores supervisor locks of dead processes and names live ones', async () => {
  const h = await harness({
    volumes: [{ Name: 'bench-inventree-dev-db', Labels: 'bench-intake.owner=inventree-dev' }],
  })
  try {
    const base = join(h.ctx.home, '.local/state/bench-intake')
    await mkdir(join(base, 'app'), { recursive: true })
    await writeFile(
      join(base, 'app/supervisor.lock'),
      JSON.stringify({ pid: 2147483646, nonce: 'x' }),
    )
    await mkdir(join(base, 'app-live'), { recursive: true })
    await writeFile(
      join(base, 'app-live/supervisor.lock'),
      JSON.stringify({ pid: process.pid, nonce: 'y' }),
    )
    await assert.rejects(
      lib.reset(h.ctx, { yes: true, databaseServer: true, restart: false }),
      /reset_refused_supervisor_running/,
    )
    assert(h.log.some((line) => line.includes('app-live')))
    assert(!h.log.some((line) => line.endsWith('/app')))
    await rm(join(base, 'app-live'), { recursive: true })
    await lib.reset(h.ctx, { yes: true, databaseServer: true, restart: false })
  } finally {
    await rm(h.root, { recursive: true })
  }
})

test('a freshly created InvenTree database gets the first-run init timeout', async () => {
  const h = await harness()
  try {
    await writeFile(
      join(h.stateDir, 'inventree-dev.json'),
      JSON.stringify({ ...validState, tokens }),
      {
        mode: 0o600,
      },
    )
    await lib.up(h.ctx)
    const init = h.seen.find(({ args }) => lib.composeSubcommand(args) === 'up-init')
    assert.equal(
      init.options.timeoutMs,
      600_000,
      'the fake reports no inventree database, so one is created',
    )
  } finally {
    await rm(h.root, { recursive: true })
  }
})

test('a plain reset refuses while a live local-inventree app uses the instance', async () => {
  const h = await harness({
    volumes: [{ Name: 'bench-inventree-dev-db', Labels: 'bench-intake.owner=inventree-dev' }],
  })
  try {
    const base = join(h.ctx.home, '.local/state/bench-intake')
    await mkdir(join(base, 'local-inventree-abc'), { recursive: true })
    await writeFile(
      join(base, 'local-inventree-abc/supervisor.lock'),
      JSON.stringify({ pid: process.pid, nonce: 'y' }),
    )
    await mkdir(join(base, 'app-live'), { recursive: true })
    await writeFile(
      join(base, 'app-live/supervisor.lock'),
      JSON.stringify({ pid: process.pid, nonce: 'z' }),
    )
    await assert.rejects(
      lib.reset(h.ctx, { yes: true, restart: false }),
      /reset_refused_supervisor_running/,
    )
    assert(h.log.some((line) => line.includes('local-inventree-abc')))
    assert(
      !h.log.some((line) => line.includes('app-live')),
      'a fake-profile app does not use InvenTree',
    )
    await rm(join(base, 'local-inventree-abc'), { recursive: true })
    await lib.reset(h.ctx, { yes: true, restart: false })
  } finally {
    await rm(h.root, { recursive: true })
  }
})
