#!/usr/bin/env node
const { createRequire } = require('node:module')
const {
  mkdir,
  lstat,
  readFile,
  writeFile,
  open,
  unlink,
  realpath,
  rename,
} = require('node:fs/promises')
const { homedir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { createServer: netServer } = require('node:net')
const { spawn } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const { watchCode, snapshot } = require('./dev/watch.cjs')
const { launch, stop } = require('./dev/process.cjs')

const repository = resolve(__dirname, '..')
const intake = join(repository, 'intake-server')
const intakeRequire = createRequire(join(intake, 'package.json'))
const baseEnv = Object.fromEntries(
  ['PATH', 'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'LANG']
    .filter((key) => process.env[key] !== undefined)
    .map((key) => [key, process.env[key]]),
)

async function freePort(requested = 0) {
  const server = netServer()
  await new Promise((done, reject) => {
    server.once('error', reject)
    server.listen(requested, '127.0.0.1', done)
  })
  const port = server.address().port
  await new Promise((done) => server.close(done))
  return port
}

async function run(command, args, env, cwd = repository, signal) {
  signal?.throwIfAborted()
  const child = spawn(command, args, { cwd, env, stdio: 'inherit', shell: false, detached: true })
  let timer
  const abort = () => {
    if (child.pid) {
      try {
        process.kill(-child.pid, 'SIGTERM')
      } catch {}
      timer = setTimeout(() => {
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch {}
      }, 2000)
    }
  }
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) {
    abort()
  }
  let code
  try {
    code = await new Promise((done, reject) => {
      child.once('error', reject)
      child.once('close', done)
    })
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }

  if (code !== 0 || signal?.aborted) {
    throw new Error('development_setup_failed')
  }
}

function applicationArgs(entry) {
  return ['--import', pathToFileURL(intakeRequire.resolve('tsx')).href, entry]
}

async function publishRunning(root, origin, children) {
  const file = join(root, `running-${randomUUID()}.json`)
  await writeFile(
    file,
    JSON.stringify({
      supervisor: process.pid,
      origin,
      children: children.map((item) => ({ name: item.name, pid: item.child.pid })),
    }),
    { mode: 0o600, flag: 'wx' },
  )
  await rename(file, join(root, 'running.json'))
}

async function privateState(root) {
  if (root === repository || root.startsWith(repository + '/')) {
    throw new Error('development_state_must_be_outside_repository')
  }
  await mkdir(root, { recursive: true, mode: 0o700 })
  const stat = await lstat(root)
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.uid !== process.getuid?.() ||
    stat.mode & 0o077 ||
    (await realpath(root)) !== root
  ) {
    throw new Error('private_development_directory_required')
  }
  const lock = join(root, 'supervisor.lock')
  const nonce = randomUUID()
  let handle
  try {
    handle = await open(lock, 'wx', 0o600)
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new Error('development_supervisor_lock_exists_inspect_owned_state')
    }
    throw error
  }
  await handle.writeFile(JSON.stringify({ pid: process.pid, nonce }))
  await handle.close()
  return async () => {
    const owned = JSON.parse(await readFile(lock, 'utf8'))
    if (owned.pid !== process.pid || owned.nonce !== nonce) {
      throw new Error('development_lock_owner_changed')
    }
    await unlink(lock)
  }
}

async function main() {
  if (process.argv.includes('--help')) {
    process.stdout.write(
      'pnpm dev — retained local app on http://127.0.0.1:4330; Ctrl-C stops app processes and keeps data/PostgreSQL. See docs/development.md.\n',
    )
    return
  }
  const major = Number(process.versions.node.split('.')[0])
  if (major !== 24) {
    throw new Error('pinned_node_24_required')
  }
  const port = Number(process.env.INTAKE_DEV_PORT ?? 4330)
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 4310 || port === 4350) {
    throw new Error('invalid_development_port')
  }
  await freePort(port)
  const root = resolve(
    process.env.INTAKE_APP_STATE ?? join(homedir(), '.local/state/bench-intake/app'),
  )
  const release = await privateState(root)
  const env = {
    ...baseEnv,
    INTAKE_APP_STATE: root,
    ...(process.env.INTAKE_DEV_STATE ? { INTAKE_DEV_STATE: process.env.INTAKE_DEV_STATE } : {}),
  }
  const setupEnv = {
    ...env,
    ...(process.env.INTAKE_DEV_ADMIN_URL
      ? { INTAKE_DEV_ADMIN_URL: process.env.INTAKE_DEV_ADMIN_URL }
      : {}),
  }
  let closeWatch = () => {}
  let children = []
  const startup = new AbortController()
  let closing = false
  let intentional = false
  let restart = Promise.resolve()
  let resolveStop
  const stopped = new Promise((done) => {
    resolveStop = done
  })

  const shutdown = () => {
    closing = true
    startup.abort()
    for (const item of children) {
      if (item.child.exitCode === null && item.child.signalCode === null) {
        item.child.kill('SIGTERM')
      }
    }
    resolveStop()
  }
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, shutdown)
  }
  try {
    if (!process.env.INTAKE_DEV_ADMIN_URL) {
      await run(
        process.execPath,
        [join(intake, 'scripts/dev-services.cjs'), 'start'],
        env,
        repository,
        startup.signal,
      )
    }
    await run(
      process.execPath,
      applicationArgs('src/dev/setup.ts'),
      setupEnv,
      intake,
      startup.signal,
    )
    const state = JSON.parse(await readFile(join(root, 'app.json'), 'utf8'))
    const sourceRoots = [
      join(intake, 'src'),
      join(repository, 'contracts/src'),
      join(intake, 'migrations'),
    ]
    const initialSources = await Promise.all(sourceRoots.map(snapshot))
    const decoderRoots = [join(intake, 'src/media'), join(repository, 'contracts/src')]
    let decoderDigest = (await Promise.all(decoderRoots.map(snapshot))).join(':')
    let image = process.env.INTAKE_MEDIA_DECODER_IMAGE
    if (!image) {
      const file = join(root, `decoder-${randomUUID()}.txt`)
      await run(
        process.execPath,
        [join(intake, 'scripts/build-media-image.cjs'), '--output-file', file],
        env,
        repository,
        startup.signal,
      )
      image = (await readFile(file, 'utf8')).trim()
    }
    if (!/^sha256:[a-f0-9]{64}$/.test(image)) {
      throw new Error('immutable_decoder_required')
    }
    const publicOrigin = `http://127.0.0.1:${port}`
    const apiPort = await freePort()
    const scope = {
      INTAKE_ACTOR_ID: state.identity.actor,
      INTAKE_TARGET_ID: state.identity.target,
      INTAKE_TARGET_CONTEXT_ID: state.identity.context,
      INTAKE_PROCESSING_CHANNEL_SECRET: state.channelSecret,
      INTAKE_BLOB_ROOT: state.blobRoot,
    }
    const profile = process.env.INTAKE_PROCESSING_PROFILE ?? 'synthetic-research/2'
    if (!['synthetic-research/2', 'native-agent/1'].includes(profile)) {
      throw new Error('unsupported_development_profile')
    }

    let starting = false
    async function start() {
      if (closing) {
        return
      }
      starting = true
      intentional = false
      function child(name, entry, extra, ready) {
        if (closing) {
          throw new Error('development_stopping')
        }
        const owned = launch(
          name,
          process.execPath,
          entry.endsWith('.cjs') ? [entry] : applicationArgs(entry),
          { cwd: intake, env: { ...env, ...scope, ...extra } },
          ready,
        )
        children.push(owned)
        void owned.exited.then(() => {
          if (!intentional && !closing && !starting) {
            process.stderr.write(`${name} stopped; stopping the app.\n`)
            process.exitCode = 1
            shutdown()
          }
        })
        return owned
      }
      await child('inventory', 'src/dev/fake-main.ts', {}, (text) =>
        text.includes('DEV_FAKE_READY'),
      ).ready()
      await child(
        'api',
        'src/main.ts',
        {
          INTAKE_ORIGIN: publicOrigin,
          INTAKE_DEV_LISTEN_PORT: String(apiPort),
          INTAKE_DATABASE_URL: state.apiUrl,
          INTAKE_CREDENTIAL_REF: 'owned_development',
          INTAKE_DEV_API_KEY: state.runnerConfig.profile.credential,
          INTAKE_READ_ORIGIN: state.runnerConfig.profile.origin,
          INTAKE_DEPLOYMENT_ID: state.runnerConfig.deploymentId,
          INTAKE_PROCESSING_PROFILE: profile,
        },
        (text) => text.includes('"web_ready"'),
      ).ready()
      await child(
        'apply',
        'src/review/runner-main.ts',
        { INTAKE_RUNNER_CONFIG: state.runnerConfigPath },
        (text) => text.includes('manual runner ready'),
      ).ready()
      await child('media', 'src/dev/media-main.ts', { INTAKE_MEDIA_DECODER_IMAGE: image }, (text) =>
        text.includes('DEV_MEDIA_READY'),
      ).ready()
      if (profile === 'native-agent/1') {
        const providerEnv = Object.fromEntries(
          [
            'OPENAI_API_KEY',
            'ANTHROPIC_API_KEY',
            'INTAKE_CODEX_EXECUTABLE',
            'INTAKE_CLAUDE_EXECUTABLE',
          ]
            .filter((key) => process.env[key])
            .map((key) => [key, process.env[key]]),
        )
        await child(
          'agents',
          'src/agents/worker-main.ts',
          {
            ...providerEnv,
            INTAKE_PROCESSING_PROFILE: profile,
            INTAKE_AGENT_STATE_ROOT: join(root, 'agents'),
            INTAKE_AGENT_DATABASE_URL: state.processingUrl,
            INTAKE_AGENT_SCHEDULER_DATABASE_URL: state.runnerConfig.schedulerDatabaseUrl,
          },
          (text) => text.includes('supervisor ready'),
        ).ready()
      } else {
        await child('processing', 'src/dev/processing-main.ts', {}, (text) =>
          text.includes('DEV_PROCESSING_READY'),
        ).ready()
      }
      starting = false
      await publishRunning(root, publicOrigin, children)
    }
    await start()
    const ui = launch(
      'ui',
      process.execPath,
      [join(repository, 'tooling/dev/ui.cjs')],
      {
        cwd: repository,
        env: { ...env, INTAKE_DEV_PUBLIC_PORT: String(port), INTAKE_DEV_API_PORT: String(apiPort) },
      },
      (text) => text.includes('DEV_UI_READY'),
    )
    children.push(ui)
    await ui.ready()
    void ui.exited.then(() => {
      if (!closing) {
        process.exitCode = 1
        shutdown()
      }
    })
    await publishRunning(root, publicOrigin, children)
    closeWatch = await watchCode(
      sourceRoots,
      (error) => {
        if (error) {
          process.stderr.write('Source watcher failed; stopping safely.\n')
          process.exitCode = 1
          shutdown()
          return
        }
        restart = restart
          .then(async () => {
            if (closing) {
              return
            }
            process.stdout.write(
              'Source code changed; draining and restarting application services.\n',
            )
            intentional = true
            await stop(children.filter((item) => item.name !== 'ui'))
            children = children.filter((item) => item.name === 'ui')
            if (!closing) {
              try {
                await run(
                  process.execPath,
                  applicationArgs('src/dev/setup.ts'),
                  setupEnv,
                  intake,
                  startup.signal,
                )
                const nextDigest = (await Promise.all(decoderRoots.map(snapshot))).join(':')
                if (nextDigest !== decoderDigest && !process.env.INTAKE_MEDIA_DECODER_IMAGE) {
                  const file = join(root, `decoder-${randomUUID()}.txt`)
                  await run(
                    process.execPath,
                    [join(intake, 'scripts/build-media-image.cjs'), '--output-file', file],
                    env,
                    repository,
                    startup.signal,
                  )
                  image = (await readFile(file, 'utf8')).trim()
                }
                decoderDigest = nextDigest
                await start()
              } catch {
                intentional = true
                await stop(children.filter((item) => item.name !== 'ui'))
                children = children.filter((item) => item.name === 'ui')
                starting = false
                process.stderr.write(
                  'Application reload failed; fix source code to retry. Retained data is unchanged.\n',
                )
              }
            }
          })
          .catch(() => {
            process.exitCode = 1
            shutdown()
          })
        return restart
      },
      200,
      initialSources,
    )
    process.stdout.write(
      `Development app ready: ${publicOrigin}\nData retained in the configured private development namespace. Processing: ${profile}.\n`,
    )
    await stopped
  } finally {
    closing = true
    closeWatch()
    await restart
    intentional = true
    await stop(children)
    await release()
    process.stdout.write('Development app stopped; retained data and PostgreSQL preserved.\n')
  }
}
main().catch((error) => {
  const code = /^[a-z_]+$/.test(error.message ?? '') ? error.message : 'development_startup_failed'
  process.stderr.write(`${code}\n`)
  process.exitCode = 1
})
