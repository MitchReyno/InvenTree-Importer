const {
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
  lstat,
} = require('node:fs/promises')
const { join } = require('node:path')
const { randomBytes } = require('node:crypto')

const PROJECT = 'bench-inventree-dev'
const OWNER_LABEL = 'bench-intake.owner'
const OWNER = 'inventree-dev'
const IMAGE =
  'inventree/inventree@sha256:36027b18ac12e428d0adeda1428325a79c915d571f9c22e2efa0d736f68a3d53'
const ORIGIN = 'http://127.0.0.1:4320'
const DB_VOLUME = 'bench-inventree-dev-db'
const DATA_VOLUME = 'bench-inventree-dev-data'
const INVENTREE_SERVICES = ['inventree-server', 'inventree-worker', 'inventree-init']
const FILES = {
  state: 'inventree-dev.json',
  env: 'inventree.env',
  initEnv: 'inventree-init.env',
  lock: 'inventree-dev.lock',
  serverState: 'inventree-db.json',
  serverEnv: 'inventree-db.env',
}
// First run migrates a fresh database; later runs only check migrations and static files.
const INIT_TIMEOUT_MS = { first: 600_000, later: 120_000 }

class InventreeDevError extends Error {}
const refuse = (code) => new InventreeDevError(code)

function composeArgs(ctx, ...args) {
  return ['compose', '-f', join(ctx.composeDir, 'compose.yaml'), '-p', PROJECT, ...args]
}

/** The compose subcommand of a recorded docker call; the init run is named separately. */
function composeSubcommand(args) {
  if (args[0] !== 'compose') return undefined
  const sub = args[args.indexOf('-p') + 2]
  return sub === 'up' && args[args.length - 1] === 'inventree-init' ? 'up-init' : sub
}

function labels(value) {
  if (value && typeof value === 'object') return value
  return Object.fromEntries(
    String(value ?? '')
      .split(',')
      .filter(Boolean)
      .map((pair) => {
        const index = pair.indexOf('=')
        return index < 0 ? [pair, ''] : [pair.slice(0, index), pair.slice(index + 1)]
      }),
  )
}

function jsonLines(text) {
  return String(text ?? '')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

async function docker(ctx, args, options) {
  const result = await ctx.docker(args, options)
  if (result.status !== 0 && !options?.allowFailure) {
    throw refuse(options?.code ?? 'docker_command_failed')
  }
  return result
}

async function readPrivate(path, maxBytes = 16384) {
  let stat
  try {
    stat = await lstat(path)
  } catch (error) {
    if (error.code === 'ENOENT') return undefined
    throw refuse('private_owned_state_required')
  }
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.uid !== process.getuid?.() ||
    stat.mode & 0o077 ||
    stat.size > maxBytes
  ) {
    throw refuse('private_owned_state_required')
  }
  return readFile(path, 'utf8')
}

async function writePrivate(path, content) {
  const temporary = `${path}.${randomBytes(6).toString('hex')}`
  await writeFile(temporary, content, { mode: 0o600, flag: 'wx' })
  await rename(temporary, path)
}

async function privateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 })
  const stat = await lstat(path)
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.mode & 0o077) {
    throw refuse('private_development_directory_required')
  }
}

const HEX = (length) => new RegExp(`^[a-f0-9]{${length}}$`)
const TOKEN = /^inv-[A-Za-z0-9]{20,80}-\d{8}$/

function validState(state) {
  return (
    state &&
    state.version === 1 &&
    HEX(32).test(state.instance_id) &&
    state.image === IMAGE &&
    HEX(48).test(state.db_password) &&
    HEX(64).test(state.secret_key) &&
    HEX(24).test(state.admin_password) &&
    typeof state.initialized === 'boolean' &&
    (state.tokens === null ||
      (TOKEN.test(state.tokens?.reader ?? '') && TOKEN.test(state.tokens?.writer ?? '')))
  )
}

async function volumes(ctx) {
  return jsonLines((await docker(ctx, ['volume', 'ls', '--format', 'json'])).stdout)
}

/** A reserved volume must carry our label; returns whether it exists. */
async function ownedVolume(ctx, name) {
  const found = (await volumes(ctx)).find((row) => row.Name === name)
  if (found && labels(found.Labels)[OWNER_LABEL] !== OWNER) throw refuse('service_not_owned')
  return Boolean(found)
}

async function readState(ctx) {
  const text = await readPrivate(join(ctx.stateDir, FILES.state))
  if (text === undefined) return undefined
  let state
  try {
    state = JSON.parse(text)
  } catch {
    throw refuse('invalid_inventree_dev_state')
  }
  if (!validState(state)) throw refuse('invalid_inventree_dev_state')
  return state
}

async function saveState(ctx, state) {
  await writePrivate(join(ctx.stateDir, FILES.state), JSON.stringify(state))
}

/** Loads the instance's private state, creating it only when no instance data exists. */
async function ensureState(ctx) {
  await privateDirectory(ctx.stateDir)
  const existing = await readState(ctx)
  if (existing) return existing
  if (await ownedVolume(ctx, DATA_VOLUME)) {
    throw refuse('inventree_dev_state_missing_for_existing_volume')
  }
  const state = {
    version: 1,
    instance_id: randomBytes(16).toString('hex'),
    image: IMAGE,
    db_password: randomBytes(24).toString('hex'),
    secret_key: randomBytes(32).toString('hex'),
    admin_password: randomBytes(12).toString('hex'),
    initialized: false,
    tokens: null,
  }
  await saveState(ctx, state)
  return state
}

function secretsOf(ctx, state) {
  return [
    state?.db_password,
    state?.secret_key,
    state?.admin_password,
    state?.tokens?.reader,
    state?.tokens?.writer,
    ...(ctx.extraSecrets ?? []),
  ].filter(Boolean)
}

function redact(text, secrets) {
  let output = String(text ?? '')
  for (const secret of secrets) output = output.split(secret).join('[redacted]')
  return output
}

async function writeEnvFiles(ctx, state) {
  // Server and worker get only what they need; the admin password and tokens go to init alone.
  await writePrivate(
    join(ctx.stateDir, FILES.env),
    `INVENTREE_DB_PASSWORD=${state.db_password}\nINVENTREE_SECRET_KEY=${state.secret_key}\n`,
  )
  await writePrivate(
    join(ctx.stateDir, FILES.initEnv),
    [
      `INVENTREE_ADMIN_PASSWORD=${state.admin_password}`,
      `BENCH_INTAKE_READER_TOKEN=${state.tokens?.reader ?? ''}`,
      `BENCH_INTAKE_WRITER_TOKEN=${state.tokens?.writer ?? ''}`,
      '',
    ].join('\n'),
  )
}

/** One checkout drives the InvenTree services; the shared database may come from any. */
async function assertCheckout(ctx) {
  const rows = jsonLines(
    (
      await docker(ctx, [
        'ps',
        '-a',
        '--filter',
        `label=com.docker.compose.project=${PROJECT}`,
        '--format',
        'json',
      ])
    ).stdout,
  )
  for (const row of rows) {
    const values = labels(row.Labels)
    if (
      INVENTREE_SERVICES.includes(values['com.docker.compose.service']) &&
      values['com.docker.compose.project.working_dir'] !== ctx.composeDir
    ) {
      ctx.log(
        `The InvenTree services belong to another checkout (${values['com.docker.compose.project.working_dir']}); run \`pnpm inventree:dev down\` there first.`,
      )
      throw refuse('inventree_dev_owned_by_other_checkout')
    }
  }
}

async function ensureDatabase(ctx, state) {
  const role = await ctx.query("SELECT 1 FROM pg_roles WHERE rolname='inventree'")
  await ctx.query(
    role.rowCount
      ? `ALTER ROLE inventree LOGIN PASSWORD '${state.db_password}' NOSUPERUSER NOCREATEDB NOCREATEROLE CONNECTION LIMIT 20`
      : `CREATE ROLE inventree LOGIN PASSWORD '${state.db_password}' NOSUPERUSER NOCREATEDB NOCREATEROLE CONNECTION LIMIT 20`,
  )
  const database = await ctx.query("SELECT 1 FROM pg_database WHERE datname='inventree'")
  if (!database.rowCount) await ctx.query('CREATE DATABASE inventree OWNER inventree')
  await ctx.query('REVOKE CONNECT ON DATABASE inventree FROM PUBLIC')
  await ctx.query('GRANT CONNECT ON DATABASE inventree TO inventree')
}

async function logTail(ctx, service, state) {
  const logs = await ctx.docker(composeArgs(ctx, 'logs', '--no-color', '--tail', '40', service), {
    allowFailure: true,
  })
  ctx.log(redact(`${logs.stdout ?? ''}${logs.stderr ?? ''}`, secretsOf(ctx, state)))
}

async function runInit(ctx, state) {
  const removeInit = () =>
    ctx.docker(composeArgs(ctx, 'rm', '-fsv', 'inventree-init'), { allowFailure: true })
  await removeInit()
  const handoff = await mkdtemp(join(ctx.stateDir, 'handoff-'))
  try {
    const result = await ctx.docker(
      composeArgs(ctx, 'up', '--no-deps', '--exit-code-from', 'inventree-init', 'inventree-init'),
      { timeoutMs: state.initialized ? INIT_TIMEOUT_MS.later : INIT_TIMEOUT_MS.first, quiet: true },
    )
    if (result.status !== 0) {
      await logTail(ctx, 'inventree-init', state)
      throw refuse(result.timedOut ? 'inventree_init_timed_out' : 'inventree_init_failed')
    }
    const file = join(handoff, 'tokens.json')
    await docker(
      ctx,
      composeArgs(ctx, 'cp', 'inventree-init:/tmp/bench-intake-tokens.json', file),
      {
        code: 'inventree_token_handoff_failed',
      },
    )
    const tokens = JSON.parse((await readPrivate(file)) ?? 'null')
    if (!TOKEN.test(tokens?.reader ?? '') || !TOKEN.test(tokens?.writer ?? '')) {
      throw refuse('inventree_token_handoff_failed')
    }
    state.tokens = { reader: tokens.reader, writer: tokens.writer }
    state.initialized = true
    await saveState(ctx, state)
  } finally {
    await rm(handoff, { recursive: true, force: true })
    await removeInit()
  }
}

async function withLock(ctx, action) {
  await privateDirectory(ctx.stateDir)
  const path = join(ctx.stateDir, FILES.lock)
  for (let attempt = 0; ; attempt++) {
    try {
      const handle = await open(path, 'wx', 0o600)
      await handle.writeFile(JSON.stringify({ pid: process.pid }))
      await handle.close()
      break
    } catch (error) {
      if (error.code !== 'EEXIST' || attempt > 0) throw refuse('inventree_dev_lock_held')
      let holder
      try {
        holder = JSON.parse(await readFile(path, 'utf8')).pid
        process.kill(holder, 0)
      } catch (probe) {
        if (holder === undefined || probe.code === 'ESRCH') {
          await rm(path, { force: true })
          continue
        }
      }
      throw refuse('inventree_dev_lock_held')
    }
  }
  try {
    return await action()
  } finally {
    await rm(path, { force: true })
  }
}

async function upUnlocked(ctx, options = {}) {
  await ctx.startServices()
  await assertCheckout(ctx)
  const state = await ensureState(ctx)
  await writeEnvFiles(ctx, state)
  await ensureDatabase(ctx, state)
  await runInit(ctx, state)
  // The init run passed the tokens it reused or issued; keep init's env in step for next time.
  await writeEnvFiles(ctx, state)
  const server = await ctx.docker(
    composeArgs(
      ctx,
      'up',
      '-d',
      '--no-deps',
      '--wait',
      '--wait-timeout',
      '60',
      'inventree-server',
      'inventree-worker',
    ),
    { quiet: true },
  )
  if (server.status !== 0) {
    await logTail(ctx, 'inventree-server', state)
    throw refuse('inventree_server_unhealthy')
  }
  if (options.seed !== false) await ctx.seed(state)
  ctx.log(
    `Local InvenTree ready at ${ORIGIN} (admin user: admin). Show credentials with \`pnpm inventree:dev credentials\`.`,
  )
  return state
}

const up = (ctx, options) => withLock(ctx, () => upUnlocked(ctx, options))

async function seedCommand(ctx) {
  return withLock(ctx, async () => {
    const state = await readState(ctx)
    if (!state?.tokens) throw refuse('inventree_dev_not_ready_run_up')
    await ctx.seed(state)
  })
}

async function down(ctx) {
  await docker(ctx, composeArgs(ctx, 'rm', '-fsv', ...INVENTREE_SERVICES))
  ctx.log('InvenTree stopped; the shared inventree-db keeps running for intake.')
}

/** Default namespace roots that may hold a running supervisor's lock. */
async function supervisorLocks(ctx) {
  const roots = new Set([ctx.stateDir, join(ctx.home, '.local/state/bench-intake')])
  const held = []
  for (const root of roots) {
    let entries = []
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries.filter((item) => item.isDirectory())) {
      try {
        await lstat(join(root, entry.name, 'supervisor.lock'))
        held.push(join(root, entry.name))
      } catch {}
    }
  }
  return held
}

async function reset(ctx, options = {}) {
  if (!options.yes) throw refuse('reset_requires_yes')
  return withLock(ctx, async () => {
    if (options.databaseServer) {
      if (ctx.env.INTAKE_APP_STATE) throw refuse('reset_refused_explicit_app_state')
      if ((await supervisorLocks(ctx)).length) throw refuse('reset_refused_supervisor_running')
    }
    const hasData = await ownedVolume(ctx, DATA_VOLUME)
    const hasDatabase = await ownedVolume(ctx, DB_VOLUME)
    await docker(ctx, composeArgs(ctx, 'rm', '-fsv', ...INVENTREE_SERVICES))
    if (options.databaseServer) {
      await docker(ctx, composeArgs(ctx, 'rm', '-fsv', 'inventree-db'))
      if (hasDatabase) await docker(ctx, ['volume', 'rm', DB_VOLUME])
      for (const file of [FILES.serverState, FILES.serverEnv]) {
        await rm(join(ctx.stateDir, file), { force: true })
      }
    } else if (hasDatabase) {
      await ctx.startServices()
      await ctx.query('DROP DATABASE IF EXISTS inventree WITH (FORCE)')
      await ctx.query('DROP ROLE IF EXISTS inventree')
    }
    if (hasData) await docker(ctx, ['volume', 'rm', DATA_VOLUME])
    for (const file of [FILES.state, FILES.env, FILES.initEnv]) {
      await rm(join(ctx.stateDir, file), { force: true })
    }
    ctx.log(
      options.databaseServer
        ? 'Reset InvenTree and the shared database server; every intake dev database was removed.'
        : 'Reset InvenTree; intake dev databases were kept.',
    )
    if (options.restart !== false) await upUnlocked(ctx)
  })
}

async function credentials(ctx) {
  const state = await readState(ctx)
  if (!state?.tokens) throw refuse('inventree_dev_not_ready_run_up')
  ctx.log(
    [
      `URL:           ${ORIGIN}`,
      'Admin user:    admin',
      `Admin password: ${state.admin_password}`,
      `Reader token:  ${state.tokens.reader}`,
      `Writer token:  ${state.tokens.writer}`,
    ].join('\n'),
  )
}

async function envCommand(ctx) {
  const state = await readState(ctx)
  if (!state?.tokens) throw refuse('inventree_dev_not_ready_run_up')
  ctx.log(`export INVENTREE_URL=${ORIGIN}\nexport INVENTREE_TOKEN=${state.tokens.writer}`)
}

async function status(ctx) {
  const rows = jsonLines(
    (
      await docker(ctx, [
        'ps',
        '-a',
        '--filter',
        `label=com.docker.compose.project=${PROJECT}`,
        '--format',
        'json',
      ])
    ).stdout,
  )
  const state = await readState(ctx)
  ctx.log(
    [
      `Local InvenTree: ${ORIGIN} (${state?.tokens ? 'ready' : 'not set up'})`,
      ...rows.map((row) => `  ${row.Names}: ${row.Status}`),
    ].join('\n'),
  )
}

module.exports = {
  IMAGE,
  ORIGIN,
  PROJECT,
  FILES,
  InventreeDevError,
  composeArgs,
  composeSubcommand,
  credentials,
  down,
  ensureState,
  envCommand,
  readState,
  redact,
  reset,
  seedCommand,
  status,
  up,
}
