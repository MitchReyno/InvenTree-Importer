const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const {
  mkdtemp,
  mkdir,
  writeFile,
  symlink,
  lstat,
  chmod,
  realpath,
  rm,
} = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')
const { appStateRoot, prepareCodexHome, runCodexLogin } = require('../codex-login.cjs')

const repository = join(__dirname, '../..')
const intake = join(repository, 'intake-server')

async function developmentStateRoot(settings, target, scope) {
  const targetModule = await import(pathToFileURL(join(intake, 'src/dev/target.ts')).href)
  return targetModule.developmentStateRoot(settings, target, scope)
}

async function developmentTarget(settings) {
  const targetModule = await import(pathToFileURL(join(intake, 'src/dev/target.ts')).href)
  return targetModule.developmentTarget(settings)
}

async function tempDirectory() {
  // macOS tmpdir is reached through /var, a symlink. The home check requires the path itself.
  return mkdtemp(join(await realpath(tmpdir()), 'codex-login-'))
}

function serverState(serverId) {
  return JSON.stringify({
    version: 1,
    server_id: serverId,
    admin: 'a'.repeat(48),
    migrator: 'b'.repeat(48),
    app: 'c'.repeat(48),
  })
}

function recordedSpawn(result = { code: 0, signal: null }) {
  const calls = []
  const spawnImpl = (command, args, options) => {
    calls.push({ command, args, options })
    const child = new EventEmitter()
    queueMicrotask(() => {
      if (result.error) {
        child.emit('error', result.error)
        return
      }
      child.emit('close', result.code, result.signal)
    })
    return child
  }
  return { calls, spawnImpl }
}

test('explicit app state is the login directory and ignores a host CODEX_HOME', async () => {
  const root = await tempDirectory()
  const { calls, spawnImpl } = recordedSpawn()
  const lines = []
  const code = await runCodexLogin({
    settings: { INTAKE_APP_STATE: root },
    spawnImpl,
    baseEnv: {
      PATH: '/usr/bin',
      CODEX_HOME: '/host/codex',
      OPENAI_API_KEY: 'not-copied-as-login',
      INTAKE_INVENTREE_TOKEN: 'synthetic-inventory-token',
    },
    log: (line) => lines.push(line),
  })
  assert.equal(code, 0)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].command, 'codex')
  assert.deepEqual(calls[0].args, ['login'])
  assert.equal(calls[0].options.stdio, 'inherit')
  assert.equal(calls[0].options.shell, false)
  assert.equal(calls[0].options.env.CODEX_HOME, join(root, 'agents', 'codex'))
  assert.equal(calls[0].options.env.PATH, '/usr/bin')
  assert.equal(calls[0].options.env.INTAKE_INVENTREE_TOKEN, undefined)
  assert.equal(lines[0].includes(join(root, 'agents', 'codex')), true)
  const home = await lstat(join(root, 'agents', 'codex'))
  assert.equal(home.isDirectory(), true)
  assert.equal(home.mode & 0o077, 0)
  assert.equal((await lstat(join(root, 'agents'))).mode & 0o077, 0)
  await rm(root, { recursive: true })
})

test('a group-readable directory is tightened before login', async () => {
  const root = await tempDirectory()
  await chmod(root, 0o755)
  const { spawnImpl } = recordedSpawn()
  await runCodexLogin({
    settings: { INTAKE_APP_STATE: root },
    spawnImpl,
    log: () => {},
  })
  assert.equal((await lstat(root)).mode & 0o077, 0)
  assert.equal((await lstat(join(root, 'agents', 'codex'))).mode & 0o077, 0)
  await rm(root, { recursive: true })
})

test('login uses INTAKE_CODEX_EXECUTABLE and returns the CLI status', async () => {
  const root = await tempDirectory()
  const { calls, spawnImpl } = recordedSpawn({ code: 2, signal: null })
  const code = await runCodexLogin({
    settings: { INTAKE_APP_STATE: root, INTAKE_CODEX_EXECUTABLE: '/opt/codex' },
    spawnImpl,
    log: () => {},
  })
  assert.equal(code, 2)
  assert.equal(calls[0].command, '/opt/codex')
  await rm(root, { recursive: true })
})

test('a missing Codex binary is reported without running a shell', async () => {
  const root = await tempDirectory()
  const { spawnImpl } = recordedSpawn({
    error: Object.assign(new Error('spawn'), { code: 'ENOENT' }),
  })
  await assert.rejects(
    runCodexLogin({
      settings: { INTAKE_APP_STATE: root },
      spawnImpl,
      log: () => {},
    }),
    /codex_executable_missing/,
  )
  await rm(root, { recursive: true })
})

test('an app state inside the repository is refused before creating a home', async () => {
  const { spawnImpl, calls } = recordedSpawn()
  await assert.rejects(
    runCodexLogin({
      settings: { INTAKE_APP_STATE: join(repository, 'tooling') },
      spawnImpl,
      log: () => {},
    }),
    /development_state_must_be_outside_repository/,
  )
  assert.equal(calls.length, 0)
})

test('a symlink or customised Codex home is refused and login is not started', async () => {
  const root = await tempDirectory()
  const elsewhere = await tempDirectory()
  await mkdir(join(root, 'agents'), { mode: 0o700 })
  await symlink(elsewhere, join(root, 'agents', 'codex'))
  const linked = recordedSpawn()
  await assert.rejects(
    runCodexLogin({
      settings: { INTAKE_APP_STATE: root },
      spawnImpl: linked.spawnImpl,
      log: () => {},
    }),
    /private_codex_home_required/,
  )
  assert.equal(linked.calls.length, 0)

  const custom = await tempDirectory()
  await prepareCodexHome(custom)
  await writeFile(join(custom, 'agents', 'codex', 'config.toml'), 'model = "hidden"\n', {
    mode: 0o600,
  })
  const configured = recordedSpawn()
  await assert.rejects(
    runCodexLogin({
      settings: { INTAKE_APP_STATE: custom },
      spawnImpl: configured.spawnImpl,
      log: () => {},
    }),
    /agent_home_customizations_refused/,
  )
  assert.equal(configured.calls.length, 0)
  await rm(root, { recursive: true })
  await rm(elsewhere, { recursive: true })
  await rm(custom, { recursive: true })
})

test('an explicit app state does not need database or local InvenTree files', async () => {
  const root = await tempDirectory()
  const resolved = await appStateRoot({
    INTAKE_APP_STATE: root,
    INTAKE_USE_LOCAL_INVENTREE: 'true',
  })
  assert.equal(resolved, root)
  await rm(root, { recursive: true })
})

test('the default fake namespace matches the dev server directory for that database', async () => {
  const stateDir = await tempDirectory()
  await chmod(stateDir, 0o700)
  const serverId = '0123456789abcdef'.repeat(2)
  await writeFile(join(stateDir, 'inventree-db.json'), serverState(serverId), { mode: 0o600 })
  const settings = {
    INTAKE_DEV_STATE: stateDir,
    INTAKE_USE_MOCK_INVENTREE: 'true',
    INTAKE_CREDENTIAL_REF: 'ignored_by_the_mock',
  }
  const root = await appStateRoot(settings)
  const fake = await developmentTarget({ INTAKE_TARGET_PROFILE: 'fake' })
  const expected = await developmentStateRoot(settings, fake, {
    serverId,
  })
  assert.equal(root, expected)
  assert.equal(root.endsWith(`app-${serverId.slice(0, 16)}`), true)
  await rm(stateDir, { recursive: true })
})

test('a local InvenTree namespace includes the instance id and does not print its token', async () => {
  const stateDir = await tempDirectory()
  await chmod(stateDir, 0o700)
  const serverId = 'abcdef0123456789'.repeat(2)
  const instanceId = 'fedcba9876543210'.repeat(2)
  const token = `inv-${'A'.repeat(24)}-20261107`
  await writeFile(join(stateDir, 'inventree-db.json'), serverState(serverId), { mode: 0o600 })
  await writeFile(
    join(stateDir, 'inventree-dev.json'),
    JSON.stringify({ instance_id: instanceId, tokens: { reader: token } }),
    { mode: 0o600 },
  )
  const settings = { INTAKE_DEV_STATE: stateDir, INTAKE_USE_LOCAL_INVENTREE: 'true' }
  const root = await appStateRoot(settings)
  const local = await developmentTarget({ INTAKE_TARGET_PROFILE: 'local-inventree' })
  const expected = await developmentStateRoot(settings, local, {
    serverId,
    instanceId,
  })
  assert.equal(root, expected)
  assert.equal(root.includes(token), false)
  assert.equal(root.includes('local-inventree-'), true)
  await rm(stateDir, { recursive: true })
})

test('a symlinked parent is refused without creating or chmodding its target', async () => {
  const root = await tempDirectory()
  const target = await tempDirectory()
  try {
    await chmod(target, 0o755)
    await symlink(target, join(root, 'parent'))
    const { calls, spawnImpl } = recordedSpawn()
    await assert.rejects(
      runCodexLogin({
        settings: { INTAKE_APP_STATE: join(root, 'parent', 'new') },
        spawnImpl,
        log: () => {},
      }),
      /private_codex_home_required/,
    )
    assert.equal(calls.length, 0)
    assert.equal((await lstat(target)).mode & 0o777, 0o755)
    await assert.rejects(lstat(join(target, 'new')), { code: 'ENOENT' })
  } finally {
    await rm(root, { recursive: true })
    await rm(target, { recursive: true })
  }
})

test('a retired setting is refused before any state is touched', async () => {
  await assert.rejects(
    appStateRoot({ INTAKE_APP_STATE: '/nonexistent', INTAKE_TARGET_PROFILE: 'local-inventree' }),
    /retired_development_setting/,
  )
})
