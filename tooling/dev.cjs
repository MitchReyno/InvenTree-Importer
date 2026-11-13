#!/usr/bin/env node
const { createRequire } = require('node:module')
const { mkdir, lstat, readFile, writeFile, realpath, rename } = require('node:fs/promises')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { createServer: netServer } = require('node:net')
const { spawn } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const { watchCode, snapshot } = require('./dev/watch.cjs')
const { processingWorker } = require('./dev/profile.cjs')
const {
  resolveDevelopmentSettings,
  targetEnvironment,
  settingsRefusalLines,
  withTargetSettingNames,
  agentWorkerSettingNames,
  personalManagementFlag,
  startupSummary,
  DevelopmentSettingsError,
} = require('./dev/settings.cjs')
const { launch, stop, startupGroup, failureCode } = require('./dev/process.cjs')
const { developmentEnvironment } = require('./dev/environment.cjs')
const { apiTargetEnv, startsApplyRunner, startSupervision } = require('./dev/stack.cjs')
const { readTailnetIdentity, tailscaleOption } = require('./dev/tailnet.cjs')
const { claimSupervisorLock, processStartedAt } = require('./dev/supervisor-lock.cjs')
const { bindSessionEnd, finishOwnedRun } = require('./dev/session.cjs')
const {
  ensureVmRunning,
  stopVm,
  shouldStopVm,
  startVmChildren,
  confirmVmChildren,
  VM_CHILD_NAMES,
} = require('./dev/vm.cjs')

const repository = resolve(__dirname, '..')
const intake = join(repository, 'intake-server')
const intakeRequire = createRequire(join(intake, 'package.json'))
const baseEnv = Object.fromEntries(
  ['PATH', 'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'LANG']
    .filter((key) => process.env[key] !== undefined)
    .map((key) => [key, process.env[key]]),
)
// Lima and the relays get the base environment, and Lima's home when the shell sets one.
const vmEnv = {
  ...baseEnv,
  ...(process.env.LIMA_HOME ? { LIMA_HOME: process.env.LIMA_HOME } : {}),
}
// Survive source reloads: the browser keeps its connection through these.
const FRONT_DOOR = new Set(['ui', 'tailnet', 'tailscale-serve'])
// The VM tunnel does not use the app services, and the relays reconnect to the restarted worker.
const KEPT_THROUGH_RELOAD = new Set([...FRONT_DOOR, ...VM_CHILD_NAMES])

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
  const described = []
  for (const item of children) {
    const startedAt = processStartedAt(item.child.pid)
    described.push({
      name: item.name,
      pid: item.child.pid,
      ...(startedAt ? { startedAt } : {}),
      ...(item.group ? { group: true } : {}),
    })
  }
  const file = join(root, `running-${randomUUID()}.json`)
  await writeFile(
    file,
    JSON.stringify({
      supervisor: process.pid,
      origin,
      children: described,
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
  return claimSupervisorLock(root)
}

async function main() {
  if (process.argv.includes('--help')) {
    process.stdout.write(
      'pnpm dev — retained local app on http://127.0.0.1:4330; Ctrl-C or closing the terminal stops app processes and keeps data/PostgreSQL. --tailscale also serves it over HTTPS on your tailnet. See docs/development.md.\n',
    )
    return
  }
  const major = Number(process.versions.node.split('.')[0])
  if (major !== 24) {
    throw new Error('pinned_node_24_required')
  }
  const settings = await developmentEnvironment(repository)
  // Every switch is resolved and refused here, before any service or state is touched.
  const resolved = resolveDevelopmentSettings(settings)
  const targetValues = targetEnvironment(settings, resolved.targetSettings)
  // Pure config only; application processes keep their existing pinned tsx entrypoints.
  const { developmentTarget, developmentCredential, developmentStateRoot } = await import(
    pathToFileURL(join(intake, 'src/dev/target.ts')).href
  )
  const target = withTargetSettingNames(() => developmentTarget(targetValues), settings)
  const targetKey = withTargetSettingNames(
    () => developmentCredential(targetValues, target),
    settings,
  )
  // Printed before setup, so an overridden setting is visible even if startup later fails.
  process.stdout.write(startupSummary(target.kind, resolved))
  const port = Number(settings.INTAKE_DEV_PORT ?? 4330)
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 4310 || port === 4350) {
    throw new Error('invalid_development_port')
  }
  let addressInUse = false
  try {
    await freePort(port)
  } catch (error) {
    if (error.code !== 'EADDRINUSE') throw error
    addressInUse = true
  }
  const tailscale = tailscaleOption(settings)
  // Fail before any setup when the tailnet cannot be served.
  const tailnet = tailscale && (await readTailnetIdentity('tailscale', tailscale.port, baseEnv))
  const { serverIdentity, stateDirectory } = await import(
    pathToFileURL(join(intake, 'src/dev/pg-identity.ts')).href
  )
  const { readLocalInventree } = await import(
    pathToFileURL(join(intake, 'src/dev/local-inventree.ts')).href
  )
  // The database server comes first: the state root is scoped to its identity.
  const preparing = new AbortController()
  const startup = new AbortController()
  let closeWatch = () => {}
  let children = []
  let closing = false
  let intentional = false
  let restart = Promise.resolve()
  let resolveStop = () => {}
  const stopped = new Promise((done) => {
    resolveStop = done
  })
  let release = async () => {}
  let reportStop = false
  let vmBooted = false
  const shutdown = () => {
    if (closing) return
    closing = true
    preparing.abort()
    startup.abort()
    for (const item of children) {
      item.terminate()
    }
    resolveStop()
  }
  /** Children the app cannot run without: when one exits outside shutdown, the app stops. */
  function stopAppWhenExited(items) {
    for (const item of items) {
      void item.exited.then(() => {
        if (!closing) {
          process.stderr.write(`${item.name} stopped; stopping the app.\n`)
          process.exitCode = 1
          shutdown()
        }
      })
    }
  }

  // SIGHUP is what a closed terminal delivers. The parent watch covers a launcher that exits first.
  const session = bindSessionEnd(shutdown)
  try {
    const started = await startSupervision(targetValues, target, {
      baseEnv,
      stateDirectory,
      startServices: (childEnv) =>
        run(
          process.execPath,
          [join(intake, 'scripts/dev-services.cjs'), 'start'],
          childEnv,
          repository,
          preparing.signal,
        ),
      startLocalInventree: (childEnv) =>
        run(
          process.execPath,
          [join(repository, 'tooling/inventree-dev/cli.cjs'), 'up'],
          childEnv,
          repository,
          preparing.signal,
        ),
      serverIdentity: (values) => serverIdentity(values),
      readLocalInventree: (values) => readLocalInventree(values),
      stateRoot: developmentStateRoot,
      privateState,
    })
    release = started.release
    reportStop = true
    if (closing) return
    // Orphans can hold the public port; reclaim stops them before this second check.
    if (addressInUse) {
      await freePort(port)
    }
    if (resolved.vm) {
      await ensureVmRunning(resolved.vm, {
        signal: startup.signal,
        env: vmEnv,
        onBoot: () => {
          vmBooted = true
          process.stdout.write(`Starting VM ${resolved.vm.name}.\n`)
        },
      })
      const vmChildren = startVmChildren(resolved.vm, {
        launch,
        execPath: process.execPath,
        repository,
        baseEnv: vmEnv,
      })
      children.push(...vmChildren)
      await confirmVmChildren(vmChildren, { signal: startup.signal })
      stopAppWhenExited(vmChildren)
    }
    const { serviceEnv, prepared } = started
    const root = prepared.root
    // The local read key exists only once `inventree:dev up` has run.
    const readKey = target.kind === 'local-inventree' ? prepared.key : targetKey
    const env = { ...serviceEnv, INTAKE_APP_STATE: root }
    const setupEnv = {
      ...env,
      INTAKE_TARGET_PROFILE: target.kind,
      ...(target.kind === 'read-only'
        ? { INTAKE_READ_ORIGIN: target.origin, INTAKE_CREDENTIAL_REF: target.credentialRef }
        : {}),
      ...(settings.INTAKE_DEV_ADMIN_URL
        ? { INTAKE_DEV_ADMIN_URL: settings.INTAKE_DEV_ADMIN_URL }
        : {}),
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
      join(repository, 'media-decoder/src'),
      join(intake, 'migrations'),
    ]
    const initialSources = await Promise.all(sourceRoots.map(snapshot))
    const decoderRoots = [join(repository, 'media-decoder/src'), join(repository, 'contracts/src')]
    let decoderDigest = (await Promise.all(decoderRoots.map(snapshot))).join(':')
    let image = settings.INTAKE_MEDIA_DECODER_IMAGE
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
    const profile = resolved.profile
    const worker = processingWorker(profile)
    let writerUrl
    if (worker?.entry.endsWith('session-worker-main.ts')) {
      const { readAgentWriterUrl } = await import(
        pathToFileURL(join(intake, 'src/dev/agent-writer.ts')).href
      )
      writerUrl = await readAgentWriterUrl(root, state.databaseName)
      if (!writerUrl) {
        throw new Error('agent_writer_required')
      }
    }

    let starting = false
    async function start() {
      if (closing) {
        return
      }
      starting = true
      intentional = false
      const group = startupGroup(startup.signal)

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
        return group.watch(owned)
      }

      if (state.version === 1) {
        await child('inventory', 'src/dev/fake-main.ts', {}, (text) =>
          text.includes('DEV_FAKE_READY'),
        ).ready()
      }
      await child(
        'api',
        'src/main.ts',
        {
          INTAKE_ORIGIN: publicOrigin,
          INTAKE_DEV_LISTEN_PORT: String(apiPort),
          INTAKE_DATABASE_URL: state.apiUrl,
          ...apiTargetEnv(target, state, readKey, { readOnly: resolved.readOnly }),
          INTAKE_PROCESSING_PROFILE: profile,
          // Lets the connection status name the owned test target.
          INTAKE_TARGET_PROFILE: target.kind,
        },
        (text) => text.includes('"web_ready"'),
      ).ready()
      if (startsApplyRunner(state, resolved.readOnly)) {
        await child(
          'apply',
          'src/review/runner-main.ts',
          { INTAKE_RUNNER_CONFIG: state.runnerConfigPath },
          (text) => text.includes('manual runner ready'),
        ).ready()
      }
      await child('media', 'src/dev/media-main.ts', { INTAKE_MEDIA_DECODER_IMAGE: image }, (text) =>
        text.includes('DEV_MEDIA_READY'),
      ).ready()
      if (worker) {
        const providerEnv = Object.fromEntries(
          agentWorkerSettingNames(resolved)
            .filter((key) => settings[key])
            .map((key) => [key, settings[key]]),
        )
        await child(
          'agents',
          worker.entry,
          {
            ...providerEnv,
            INTAKE_PROCESSING_PROFILE: profile,
            INTAKE_AGENT_STATE_ROOT: join(root, 'agents'),
            INTAKE_AGENT_DATABASE_URL: state.processingUrl,
            INTAKE_AGENT_SCHEDULER_DATABASE_URL:
              state.version === 1 ? state.runnerConfig.schedulerDatabaseUrl : state.schedulerUrl,
            ...(writerUrl ? { INTAKE_AGENT_WRITER_DATABASE_URL: writerUrl } : {}),
          },
          (text) => text.includes(worker.ready),
        ).ready()
      } else {
        await child('processing', 'src/dev/processing-main.ts', {}, (text) =>
          text.includes('DEV_PROCESSING_READY'),
        ).ready()
      }
      group.confirm()
      starting = false
      await publishRunning(root, publicOrigin, children)
    }
    await start()
    startup.signal.throwIfAborted()
    const ui = launch(
      'ui',
      process.execPath,
      [join(repository, 'tooling/dev/ui.cjs')],
      {
        cwd: repository,
        env: {
          ...env,
          INTAKE_PERSONAL_MANAGEMENT: personalManagementFlag(resolved),
          INTAKE_DEV_PUBLIC_PORT: String(port),
          INTAKE_DEV_API_PORT: String(apiPort),
        },
      },
      (text) => text.includes('DEV_UI_READY'),
    )
    children.push(ui)
    await ui.ready(30000, startup.signal)
    void ui.exited.then(() => {
      if (!closing) {
        process.exitCode = 1
        shutdown()
      }
    })
    if (tailnet) {
      const gatewayPort = await freePort()
      const gateway = launch(
        'tailnet',
        process.execPath,
        [join(repository, 'tooling/dev/tailnet.cjs')],
        {
          cwd: repository,
          env: {
            ...baseEnv,
            INTAKE_DEV_PUBLIC_PORT: String(port),
            INTAKE_DEV_TAILNET_GATEWAY_PORT: String(gatewayPort),
            INTAKE_DEV_TAILNET_ORIGIN: tailnet.origin,
            INTAKE_DEV_TAILNET_LOGIN: tailnet.login,
          },
        },
        (text) => text.includes('DEV_TAILNET_READY'),
      )
      children.push(gateway)
      await gateway.ready(10000, startup.signal)
      // Foreground serve: tailscaled drops the config when this process exits.
      const serve = launch(
        'tailscale-serve',
        'tailscale',
        ['serve', `--https=${tailscale.port}`, `http://127.0.0.1:${gatewayPort}`],
        // The CLI may be a wrapper script; the binary must get the signal to remove its config.
        { cwd: repository, env: baseEnv, group: true },
        (text) => {
          if (text.includes('Serve is not enabled')) {
            throw new Error('tailscale_serve_not_enabled')
          }
          return text.includes(`proxy http://127.0.0.1:${gatewayPort}`)
        },
      )
      children.push(serve)
      await serve.ready(30000, startup.signal)
      stopAppWhenExited([gateway, serve])
    }
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
            await stop(children.filter((item) => !KEPT_THROUGH_RELOAD.has(item.name)))
            children = children.filter((item) => KEPT_THROUGH_RELOAD.has(item.name))
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
                if (nextDigest !== decoderDigest && !settings.INTAKE_MEDIA_DECODER_IMAGE) {
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
                await stop(children.filter((item) => !KEPT_THROUGH_RELOAD.has(item.name)))
                children = children.filter((item) => KEPT_THROUGH_RELOAD.has(item.name))
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
      `Development app ready: ${publicOrigin}\n${tailnet ? `Tailnet: ${tailnet.origin} (${tailnet.login} only)\n` : ''}Data retained in the configured private development namespace.\n`,
    )
    await stopped
  } finally {
    session.close()
    closing = true
    closeWatch()
    try {
      await restart
      intentional = true
      await finishOwnedRun(children, stop)
    } finally {
      try {
        if (resolved.vm && shouldStopVm(resolved.vm, vmBooted)) {
          process.stdout.write(`Stopping VM ${resolved.vm.name}.\n`)
          await stopVm(resolved.vm, { env: vmEnv })
        }
      } catch {
        process.stderr.write(`vm_stop_failed: run limactl stop ${resolved.vm.name}\n`)
      } finally {
        await release()
        if (reportStop) {
          process.stdout.write('Development app stopped; retained data and PostgreSQL preserved.\n')
        }
      }
    }
  }
}
main().catch((error) => {
  if (error instanceof DevelopmentSettingsError) {
    process.stderr.write(`${settingsRefusalLines(error).join('\n')}\n`)
    process.exitCode = 1
    return
  }
  process.stderr.write(`${failureCode(error)}\n`)
  process.exitCode = 1
})
