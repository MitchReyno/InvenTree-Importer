const { spawnSync } = require('node:child_process')
const { mkdir, writeFile, rename } = require('node:fs/promises')
const { resolve } = require('node:path')
const { randomBytes } = require('node:crypto')
const { Pool } = require('pg')
// Reuse the runtime grant contract and dev identity through pinned Node's native type stripping.
const { grantFoundation } = require('#/operations/grants.ts')
const {
  PG,
  ALLOCATION,
  SERVER_ENV_FILE,
  SERVER_STATE_FILE,
  composeFile,
  readServerState,
  serverIdentity,
  serverUrl,
  stateDirectory,
} = require('#/dev/pg-identity.ts')
// The same allowlisted root .env as `pnpm dev`, so both agree on INTAKE_DEV_STATE.
const { developmentEnvironment } = require('../../tooling/dev/environment.cjs')
const { dockerPath, jsonLines, labels, runner } = require('#/dev/docker-cli.ts')

const ACTIONS = [
  'start',
  'test',
  'migrate',
  'test:process',
  'preview:manual',
  'preview:attachments',
]

function drifted(inspected) {
  const port = inspected.HostConfig?.PortBindings?.['5432/tcp']
  return (
    inspected.Config?.Image !== ALLOCATION.image ||
    JSON.stringify(inspected.Config?.Cmd) !== JSON.stringify(ALLOCATION.command) ||
    port?.length !== 1 ||
    port[0].HostIp !== PG.host ||
    port[0].HostPort !== String(PG.port) ||
    inspected.HostConfig.Memory !== ALLOCATION.memory ||
    inspected.HostConfig.NanoCpus !== ALLOCATION.nanoCpus ||
    inspected.HostConfig.PidsLimit !== ALLOCATION.pids ||
    inspected.HostConfig.RestartPolicy?.Name !== 'no' ||
    !inspected.Mounts?.some(
      (mount) =>
        mount.Type === 'volume' &&
        mount.Name === PG.volume &&
        mount.Destination === '/var/lib/postgresql/data',
    )
  )
}

async function writePrivate(path, content) {
  const temporary = `${path}.${randomBytes(6).toString('hex')}`
  await writeFile(temporary, content, { mode: 0o600, flag: 'wx' })
  await rename(temporary, path)
}

async function main() {
  const settings = await developmentEnvironment(resolve(__dirname, '../..'))
  const env = {
    ...process.env,
    ...(settings.INTAKE_DEV_STATE ? { INTAKE_DEV_STATE: settings.INTAKE_DEV_STATE } : {}),
  }
  if (process.argv[2] === 'identity') {
    // Docker-free and read-only: names the provisioned server, never creates it.
    process.stdout.write(`${await serverIdentity(env)}\n`)
    return
  }
  const directory = stateDirectory(env)
  const docker = await dockerPath(env)
  const run = runner(docker)
  const containers = jsonLines(run('ps', '-a', '--format', 'json'))
  process.stdout.write(
    `Inspected containers: ${JSON.stringify(containers.map(({ Names, Image, Status, Ports }) => ({ Names, Image, Status, Ports })))}\n`,
  )
  process.stdout.write(run('compose', 'ls'))
  const action = process.argv[2] ?? 'status'
  if (action === 'status') return
  if (!ACTIONS.includes(action)) throw new Error('unsupported_service_action')

  const volumes = jsonLines(run('volume', 'ls', '--format', 'json'))
  const volume = volumes.find((row) => row.Name === PG.volume)
  if (volume && labels(volume.Labels)[PG.ownerLabel] !== PG.owner)
    throw new Error('service_not_owned')
  const existing = containers.find((row) => row.Names === PG.container)
  if (
    containers.some(
      (row) => row.Names !== PG.container && String(row.Ports ?? '').includes(`:${PG.port}->`),
    )
  )
    throw new Error('service_port_not_owned')

  let state
  try {
    state = await readServerState(env)
  } catch {
    throw new Error('invalid_owned_service_state')
  }
  if (!state && (volume || existing))
    throw new Error('inventree_db_state_missing_for_existing_volume')

  if (existing) {
    // Do not print inspect: Config.Env contains the private initialization secret.
    const inspected = JSON.parse(run('inspect', PG.container))[0]
    if (inspected.Config?.Labels?.[PG.ownerLabel] !== PG.owner) throw new Error('service_not_owned')
    if (drifted(inspected)) throw new Error('owned_service_allocation_changed_request_coordinator')
    if (!String(existing.Status).startsWith('Up') && action !== 'start')
      throw new Error('owned_service_stopped_run_start')
  } else if (action !== 'start') {
    throw new Error('owned_service_missing_run_start')
  }

  if (state && !volume && !existing) {
    // Re-created server: a new identity gives apps fresh namespaces; the secrets initialise it.
    state = { ...state, server_id: randomBytes(16).toString('hex') }
    await writePrivate(resolve(directory, SERVER_STATE_FILE), JSON.stringify(state))
  }
  if (!state) {
    state = {
      version: 1,
      server_id: randomBytes(16).toString('hex'),
      admin: randomBytes(24).toString('hex'),
      migrator: randomBytes(24).toString('hex'),
      app: randomBytes(24).toString('hex'),
    }
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await writeFile(resolve(directory, SERVER_STATE_FILE), JSON.stringify(state), {
      mode: 0o600,
      flag: 'wx',
    })
  }
  if (action === 'start') {
    // Compose reads POSTGRES_PASSWORD from this file; it only applies when the volume is created.
    await writePrivate(resolve(directory, SERVER_ENV_FILE), `POSTGRES_PASSWORD=${state.admin}\n`)
    const result = spawnSync(
      docker,
      [
        'compose',
        '-f',
        composeFile(),
        '-p',
        PG.project,
        'up',
        '-d',
        '--no-recreate',
        '--wait',
        PG.service,
      ],
      {
        env: { ...env, BENCH_INVENTREE_DEV_STATE: directory },
        stdio: ['ignore', 'ignore', 'inherit'],
      },
    )
    if (result.status !== 0) throw new Error('postgres_start_failed')
  }

  const adminUrl = serverUrl('postgres', state.admin, 'postgres').toString()
  const migratorUrl = serverUrl('intake_dev_migrator', state.migrator, 'intake_dev').toString()
  const admin = new Pool({ connectionString: adminUrl, max: 1 })
  try {
    for (const [role, password] of [
      ['intake_dev_migrator', state.migrator],
      ['intake_dev_app', state.app],
    ]) {
      if (!(await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rowCount)
        await admin.query(
          `CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE CONNECTION LIMIT 8`,
        )
    }
    if (!(await admin.query("SELECT 1 FROM pg_database WHERE datname='intake_dev' ")).rowCount)
      await admin.query('CREATE DATABASE intake_dev OWNER intake_dev_migrator')
  } finally {
    await admin.end()
  }
  process.stdout.write(
    `Owned PostgreSQL ready: inventree-db on loopback ${PG.port}; intake_dev; runtime/migration roles separate; secrets retained privately.\n`,
  )
  if (action !== 'start') {
    const command = action === 'test' ? 'test:pg' : action
    const result = spawnSync('pnpm', ['--filter', '@invimport/intake-server', command], {
      stdio: 'inherit',
      env: {
        ...env,
        INTAKE_TEST_ADMIN_URL: adminUrl,
        INTAKE_TEST_ALLOW_CREATE_DATABASE: 'owned-sandbox',
        INTAKE_DATABASE_URL: migratorUrl,
      },
    })
    process.exitCode = result.status ?? 1
    if (action === 'migrate' && result.status === 0) {
      const owner = new Pool({ connectionString: migratorUrl, max: 1 })
      try {
        await grantFoundation(owner, 'intake_dev_app')
      } finally {
        await owner.end()
      }
    }
  }
}
main().catch((error) => {
  // Driver/child-process diagnostics may carry configuration; surface only safe codes.
  const message = /^[a-z_]+$/.test(error.message) ? error.message : 'owned_service_action_failed'
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
