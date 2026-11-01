const { execFileSync, spawnSync } = require('node:child_process')
const { access, lstat, mkdir, readFile, writeFile } = require('node:fs/promises')
const { homedir } = require('node:os')
const { resolve } = require('node:path')
const { randomBytes } = require('node:crypto')
const { Pool } = require('pg')
// Reuse the runtime grant contract through pinned Node's native type stripping.
const { grantFoundation } = require('../src/operations/grants.ts')

async function main() {
const name = 'bench-intake-dev-pg'
const volume = 'bench-intake-dev-pg-data'
const stateDirectory = resolve(process.env.INTAKE_DEV_STATE ?? resolve(homedir(), '.local/state/bench-intake'))
const stateFile = resolve(stateDirectory, 'postgres.json')
async function dockerPath() {
  if (process.env.DOCKER_BIN) return process.env.DOCKER_BIN
  const found = spawnSync('which', ['docker'], { encoding: 'utf8' })
  if (found.status === 0) return found.stdout.trim()
  // Discover Docker.app by bundle ID; no developer-specific absolute executable path.
  const applications = execFileSync('mdfind', ['kMDItemCFBundleIdentifier == "com.docker.docker"'], { encoding: 'utf8' }).trim().split('\n')
  for (const app of applications) {
    const candidate = resolve(app, 'Contents/Resources/bin/docker')
    try { await access(candidate); return candidate } catch { /* next bundle */ }
  }
  throw new Error('docker_not_found_set_DOCKER_BIN')
}
const docker = await dockerPath()
const run = (...args) => execFileSync(docker, args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
const containers = run('ps', '-a', '--format', 'json').split('\n').filter(Boolean).map(line => JSON.parse(line))
process.stdout.write(`Inspected containers: ${JSON.stringify(containers.map(({ Names, Image, Status, Ports }) => ({ Names, Image, Status, Ports })))}\n`)
process.stdout.write(run('compose', 'ls'))
const action = process.argv[2] ?? 'status'
if (action === 'status') process.exit(0)
if (!['start', 'test', 'migrate', 'test:process'].includes(action)) throw new Error('unsupported_service_action')
let state
try {
  const info = await lstat(stateFile)
  if (!info.isFile() || (info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()) throw new Error('private_owned_state_required')
  state = JSON.parse(await readFile(stateFile, 'utf8'))
} catch (error) {
  if (error.code !== 'ENOENT') throw new Error('invalid_owned_service_state')
  if (containers.some(container => container.Names === name)) throw new Error('existing_service_missing_owned_state')
  state = { admin: randomBytes(24).toString('hex'), migrator: randomBytes(24).toString('hex'), app: randomBytes(24).toString('hex') }
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 })
  await writeFile(stateFile, JSON.stringify(state), { mode: 0o600, flag: 'wx' })
}
if (!state || !['admin', 'migrator', 'app'].every(key => /^[a-f0-9]{48}$/.test(state[key]))) throw new Error('invalid_owned_service_state')
const existing = containers.find(container => container.Names === name)
if (existing) {
  // Do not print inspect: Config.Env contains the private initialization secret.
  const inspected = JSON.parse(run('inspect', name))[0]
  const port = inspected.HostConfig.PortBindings?.['5432/tcp']
  if (inspected.Config.Labels?.['bench-intake.owner'] !== 'T01') throw new Error('service_not_owned')
  if (inspected.Config.Image !== 'postgres:17' || port?.length !== 1 || port[0].HostIp !== '127.0.0.1' || port[0].HostPort !== '55432'
    || inspected.HostConfig.Memory !== 268435456 || inspected.HostConfig.NanoCpus !== 500000000 || inspected.HostConfig.PidsLimit !== 128
    || inspected.HostConfig.RestartPolicy.Name !== 'no'
    || !inspected.Mounts.some(mount => mount.Type === 'volume' && mount.Name === volume && mount.Destination === '/var/lib/postgresql/data')
    || JSON.stringify(inspected.Config.Cmd) !== JSON.stringify(['-c', 'max_connections=40', '-c', 'shared_buffers=32MB'])) throw new Error('owned_service_allocation_changed_request_coordinator')
  // Only an explicit start may start a stopped owned service. No stop/restart/cleanup command.
  if (!existing.Status.startsWith('Up')) {
    if (action !== 'start') throw new Error('owned_service_stopped_run_start')
    run('start', name)
  }
} else {
  if (containers.some(container => /postgres/i.test(container.Image))) throw new Error('existing_postgres_request_ledger_allocation_before_creating')
  execFileSync(docker, ['run', '-d', '--name', name, '--label', 'bench-intake.owner=T01', '--cpus', '0.5', '--memory', '256m', '--pids-limit', '128', '--restart', 'no', '-p', '127.0.0.1:55432:5432', '-v', `${volume}:/var/lib/postgresql/data`, '-e', 'POSTGRES_PASSWORD', 'postgres:17', '-c', 'max_connections=40', '-c', 'shared_buffers=32MB'], { env: { ...process.env, POSTGRES_PASSWORD: state.admin }, stdio: ['ignore', 'pipe', 'pipe'] })
}
const adminUrl = `postgresql://postgres:${state.admin}@127.0.0.1:55432/postgres`
for (let i = 0; ; i++) {
  if (spawnSync(docker, ['exec', name, 'pg_isready', '-U', 'postgres'], { stdio: 'ignore' }).status === 0) break
  if (i === 30) throw new Error('postgres_start_timeout')
  await new Promise(resolve => setTimeout(resolve, 500))
}
const admin = new Pool({ connectionString: adminUrl, max: 1 })
try {
  for (const [role, password] of [['intake_dev_migrator', state.migrator], ['intake_dev_app', state.app]]) {
    if (!(await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rowCount) await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE CONNECTION LIMIT 8`)
  }
  if (!(await admin.query("SELECT 1 FROM pg_database WHERE datname='intake_dev' ")).rowCount) await admin.query('CREATE DATABASE intake_dev OWNER intake_dev_migrator')
} finally { await admin.end() }
process.stdout.write('Owned PostgreSQL ready: loopback 55432; intake_dev; runtime/migration roles separate; secrets retained privately.\n')
if (action !== 'start') {
  const command = action === 'test' ? 'test:pg' : action
  const result = spawnSync('pnpm', ['--filter', '@invimport/intake-server', command], {
    stdio: 'inherit',
    env: { ...process.env, INTAKE_TEST_ADMIN_URL: adminUrl, INTAKE_TEST_ALLOW_CREATE_DATABASE: 'owned-sandbox', INTAKE_DATABASE_URL: `postgresql://intake_dev_migrator:${state.migrator}@127.0.0.1:55432/intake_dev` },
  })
  process.exitCode = result.status ?? 1
  if (action === 'migrate' && result.status === 0) {
    const owner = new Pool({ connectionString: `postgresql://intake_dev_migrator:${state.migrator}@127.0.0.1:55432/intake_dev`, max: 1 })
    try { await grantFoundation(owner, 'intake_dev_app') } finally { await owner.end() }
  }
}
}
main().catch(error => {
  // Driver/child-process diagnostics may carry configuration; surface only safe codes.
  const message = /^[a-z_]+$/.test(error.message) ? error.message : 'owned_service_action_failed'
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
