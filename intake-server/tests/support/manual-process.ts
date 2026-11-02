import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { manualFixture } from './manual.ts'

export async function until<T>(
  read: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeout = 20000,
) {
  const deadline = Date.now() + timeout
  for (;;) {
    const value = await read()
    if (predicate(value)) {
      return value
    }
    if (Date.now() > deadline) {
      throw new Error('manual_checkpoint_timeout')
    }
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
}
export async function freePort() {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('manual_port_unavailable')
  }
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return address.port
}
export async function manualProcess(
  port?: number,
  options: { media?: boolean; effects?: boolean } = {},
) {
  const fixture = await manualFixture(options)
  await fixture.stop()
  fixture.config.origin = `http://127.0.0.1:${port ?? (await freePort())}`
  let web: ChildProcess | undefined
  let runner: ChildProcess | undefined
  let webDiagnostic = ''
  const baseEnv = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR }
  async function reap(child: ChildProcess | undefined, signal: NodeJS.Signals = 'SIGTERM') {
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      return
    }
    const exited = once(child, 'exit')
    child.kill(signal)
    await exited
  }
  async function startWeb() {
    webDiagnostic = ''
    web = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
      cwd: fileURLToPath(new URL('../../', import.meta.url)),
      env: {
        ...baseEnv,
        INTAKE_ORIGIN: fixture.config.origin,
        INTAKE_DATABASE_URL: fixture.api.url,
        INTAKE_ACTOR_ID: fixture.identity.actor,
        INTAKE_TARGET_ID: fixture.identity.target,
        INTAKE_TARGET_CONTEXT_ID: fixture.identity.context,
        INTAKE_CREDENTIAL_REF: 'owned_manual_fixture',
        INTAKE_DEV_API_KEY: 'owned-fake-token',
        INTAKE_READ_ORIGIN: fixture.fake.origin,
        INTAKE_DEPLOYMENT_ID: fixture.runnerConfig.deploymentId,
        ...(fixture.runnerConfig.mediaBlobRoot
          ? { INTAKE_BLOB_ROOT: fixture.runnerConfig.mediaBlobRoot }
          : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    web.stderr!.on('data', (bytes) => {
      if (webDiagnostic.length < 8192) webDiagnostic += bytes.toString()
    })
    await until(
      async () => {
        if (web!.exitCode !== null) {
          throw new Error('manual_web_failed')
        }
        try {
          return (await fetch(`${fixture.config.origin}/api/v1/health`)).ok
        } catch {
          return false
        }
      },
      (value) => value,
    )
    await fixture.authenticate()
  }
  async function startRunner() {
    runner = spawn(process.execPath, ['--import', 'tsx', 'src/review/runner-main.ts'], {
      cwd: fileURLToPath(new URL('../../', import.meta.url)),
      env: { ...baseEnv, INTAKE_RUNNER_CONFIG: fixture.runnerConfigPath },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let ready = false
    runner.stdout!.on('data', (bytes) => {
      if (bytes.toString().includes('manual runner ready')) {
        ready = true
      }
    })
    let diagnostic = ''
    runner.stderr!.on('data', (bytes) => {
      diagnostic += bytes.toString()
    })
    await until(
      async () => {
        if (runner!.exitCode !== null) {
          // Retain synthetic-only diagnostics locally for a failing qualification, never config content.
          throw new Error(`manual_runner_failed:${diagnostic}`)
        }
        return ready
      },
      (value) => value,
    )
  }
  return {
    ...fixture,
    get fake() {
      return fixture.fake
    },
    startWeb,
    startRunner,
    stopWeb: () => reap(web),
    stopRunner: () => reap(runner),
    get webDiagnostic() {
      return webDiagnostic
    },
    get webChild() {
      return web
    },
    get runnerChild() {
      return runner
    },
    async dispose() {
      await reap(web)
      await reap(runner)
      await fixture.dispose()
    },
  }
}
