import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { processingFixture } from '../support/processing.ts'

/**
 * Explicit qualification entrypoint only. Serves the built UI with the `synthetic-session/1`
 * profile and a real session worker, writes its URL to SESSION_PREVIEW_METADATA, and stops on
 * SIGTERM. No provider or inventory transport exists.
 */
async function main() {
  const port = Number(process.env.SESSION_PREVIEW_PORT ?? '4360')
  const metadataPath = process.env.SESSION_PREVIEW_METADATA
  if (!metadataPath || !Number.isInteger(port)) {
    throw new Error('session_preview_configuration_required')
  }
  const assets = fileURLToPath(new URL('../../../frontend/dist/', import.meta.url))
  let resolveStop: () => void = () => {}
  const stopped = new Promise<void>((resolve) => (resolveStop = resolve))
  process.once('SIGINT', resolveStop)
  process.once('SIGTERM', resolveStop)
  const fixture = await processingFixture({ profileId: 'synthetic-session/1', autoStart: false })
  const root = await mkdtemp(join(tmpdir(), 'session-browser-'))
  const stateRoot = join(root, 'state')
  await mkdir(stateRoot, { mode: 0o700 })
  let worker: ReturnType<typeof spawn> | undefined
  try {
    await fixture.start({ port, assets, live: true })
    const capture = await fixture.seedCapture()
    worker = spawn(
      process.execPath,
      ['--import', 'tsx', fileURLToPath(new URL('../../src/agents/session-worker-main.ts', import.meta.url))],
      {
        cwd: fileURLToPath(new URL('../../', import.meta.url)),
        env: {
          PATH: process.env.PATH,
          HOME: root,
          USER: process.env.USER,
          INTAKE_AGENT_DATABASE_URL: fixture.runner.url,
          INTAKE_AGENT_SCHEDULER_DATABASE_URL: fixture.scheduler.url,
          INTAKE_AGENT_STATE_ROOT: stateRoot,
          INTAKE_ACTOR_ID: fixture.config.actorId,
          INTAKE_TARGET_ID: fixture.config.targetId,
          INTAKE_TARGET_CONTEXT_ID: fixture.config.targetContextId,
          INTAKE_PROCESSING_CHANNEL_SECRET: fixture.config.channelSecret,
          INTAKE_PROCESSING_PROFILE: 'synthetic-session/1',
        },
        stdio: ['ignore', 'inherit', 'inherit'],
      },
    )
    await writeFile(
      metadataPath,
      JSON.stringify({
        url: `http://127.0.0.1:${port}/`,
        batch_id: capture.batch.id,
        packet_a: capture.packetA.id,
        parent_pid: process.pid,
      }),
    )
    process.stdout.write(`Session preview ready on 127.0.0.1:${port}\n`)
    await stopped
  } finally {
    if (worker && worker.exitCode === null) {
      worker.kill('SIGTERM')
      await new Promise((resolve) => worker!.once('exit', resolve))
    }
    await fixture.dispose()
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`session preview stopped: ${String((error as Error)?.message ?? error)}\n`)
  process.exitCode = 1
})
