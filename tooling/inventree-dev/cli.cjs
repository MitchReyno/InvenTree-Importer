#!/usr/bin/env node
const { createRequire } = require('node:module')
const { spawn } = require('node:child_process')
const { homedir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { developmentEnvironment } = require('../dev/environment.cjs')
const lib = require('./lib.cjs')
const seeding = require('./seed.cjs')

const repository = resolve(__dirname, '../..')
const intake = join(repository, 'intake-server')
const USAGE = `pnpm inventree:dev <command>

  up [--no-seed]   start the local InvenTree at ${lib.ORIGIN}, ready and seeded
  seed             re-run seeding (idempotent)
  down             stop InvenTree; the shared inventree-db keeps running
  status           show the stack's containers
  credentials      print the admin password and API tokens
  env              print export lines for INVENTREE_URL and INVENTREE_TOKEN (writer)
  reset --yes [--database-server]
                   wipe InvenTree (and with --database-server, every intake dev database)
`

function spawnCapture(command, args, options) {
  return new Promise((done, reject) => {
    const child = spawn(command, args, {
      env: options.env,
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', options.quiet ? 'pipe' : 'inherit'],
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr?.on('data', (chunk) => (stderr += chunk))
    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true
          child.kill('SIGTERM')
        }, options.timeoutMs)
      : undefined
    child.once('error', reject)
    child.once('close', (status) => {
      clearTimeout(timer)
      done({ status: timedOut ? 1 : status, stdout, stderr, timedOut })
    })
  })
}

async function context(settings) {
  const identity = await import(pathToFileURL(join(intake, 'src/dev/pg-identity.ts')).href)
  const { dockerPath } = await import(pathToFileURL(join(intake, 'src/dev/docker-cli.ts')).href)
  const stateDir = identity.stateDirectory(settings)
  const docker = await dockerPath(settings)
  const childEnv = {
    ...process.env,
    ...(settings.INTAKE_DEV_STATE ? { INTAKE_DEV_STATE: settings.INTAKE_DEV_STATE } : {}),
    BENCH_INVENTREE_DEV_STATE: stateDir,
  }
  let pool
  const ctx = {
    env: settings,
    stateDir,
    repository,
    home: homedir(),
    composeDir: __dirname,
    log: (line) => process.stdout.write(`${line}\n`),
    docker: (args, options = {}) => spawnCapture(docker, args, { ...options, env: childEnv }),
    startServices: async () => {
      const result = await spawnCapture(
        process.execPath,
        [join(intake, 'scripts/dev-services.cjs'), 'start'],
        { env: childEnv, cwd: repository, quiet: false },
      )
      if (result.status !== 0) throw new lib.InventreeDevError('postgres_start_failed')
    },
    query: async (text) => {
      if (!pool) {
        const { Pool } = createRequire(join(intake, 'package.json'))('pg')
        pool = new Pool({
          connectionString: (await identity.developmentAdmin(settings)).toString(),
          max: 1,
        })
      }
      return pool.query(text)
    },
    seed: (state) => seeding.seed(ctx, state),
    close: async () => pool?.end(),
  }
  return ctx
}

async function main() {
  const [command, ...flags] = process.argv.slice(2)
  if (!command || command === '--help' || command === 'help') {
    process.stdout.write(USAGE)
    return
  }
  const settings = await developmentEnvironment(repository)
  const ctx = await context(settings)
  try {
    const has = (flag) => flags.includes(flag)
    if (command === 'up') await lib.up(ctx, { seed: !has('--no-seed') })
    else if (command === 'seed') await lib.seedCommand(ctx)
    else if (command === 'down') await lib.down(ctx)
    else if (command === 'status') await lib.status(ctx)
    else if (command === 'credentials') await lib.credentials(ctx)
    else if (command === 'env') await lib.envCommand(ctx)
    else if (command === 'reset')
      await lib.reset(ctx, { yes: has('--yes'), databaseServer: has('--database-server') })
    else throw new lib.InventreeDevError('unsupported_inventree_dev_command')
  } finally {
    await ctx.close()
  }
}

main().catch((error) => {
  // Driver and child-process errors may carry configuration; name only stable codes.
  const code = /^[a-z_]+$/.test(error?.message ?? '') ? error.message : 'inventree_dev_failed'
  process.stderr.write(`${code}\n`)
  process.exitCode = 1
})
