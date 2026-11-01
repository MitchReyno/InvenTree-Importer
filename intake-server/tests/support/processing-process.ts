import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { processingFixture } from './processing.ts'

export async function processingCheckpoint<T>(
  read: () => Promise<T>,
  matches: (value: T) => boolean,
  timeoutMs = 20000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await read()
    if (matches(value)) return value
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
  throw new Error('synthetic_processing_checkpoint_timeout')
}

export async function processingProcess() {
  const fixture = await processingFixture()
  const root = await mkdtemp(join(tmpdir(), 'bench-synthetic-processing-'))
  const configPath = join(root, 'runner.json')
  let child: ChildProcess | undefined
  let output = ''
  let diagnostic = ''

  async function startWorker(pauseAfterClaim = false) {
    if (child) throw new Error('synthetic_processing_worker_already_started')
    await writeFile(
      configPath,
      JSON.stringify({
        ...fixture.config,
        runnerDatabaseUrl: fixture.runner.url,
        schedulerDatabaseUrl: fixture.scheduler.url,
        pauseAfterClaim,
      }),
      { mode: 0o600 },
    )
    output = ''
    diagnostic = ''
    child = spawn(process.execPath, ['--import', 'tsx', 'tests/process/processing-worker.ts'], {
      cwd: fileURLToPath(new URL('../../', import.meta.url)),
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        TMPDIR: process.env.TMPDIR,
        INTAKE_SYNTHETIC_PROCESSING_CONFIG: configPath,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout!.on('data', (bytes) => {
      output += bytes.toString()
    })
    child.stderr!.on('data', (bytes) => {
      diagnostic = (diagnostic + bytes.toString())
        .slice(-8192)
        .replace(/postgres(?:ql)?:\/\/[^\s"']+/g, '<private-database>')
        .replaceAll(fixture.config.channelSecret, '<private-channel>')
    })
    await processingCheckpoint(
      async () => {
        if (child!.exitCode !== null)
          throw new Error(`synthetic_processing_worker_failed:${diagnostic}`)
        return output
      },
      (value) => value.includes('SYNTHETIC_PROCESSING_READY'),
    )
  }

  async function stopWorker(signal: NodeJS.Signals = 'SIGTERM') {
    if (!child) return
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit')
      child.kill(signal)
      await exited
    }
    child = undefined
  }

  return {
    ...fixture,
    startWorker,
    stopWorker,
    get workerAlive() {
      return Boolean(child && child.exitCode === null && child.signalCode === null)
    },
    get output() {
      return output
    },
    async dispose() {
      await stopWorker('SIGKILL')
      await fixture.dispose()
      await rm(root, { recursive: true, force: true })
    },
  }
}
