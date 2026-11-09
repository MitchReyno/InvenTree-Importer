import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { processingFixture } from './processing.ts'
import { processingCheckpoint } from './processing-process.ts'
import { BlobStore } from '#/media/blob-store.ts'
import { readMediaStoreIdentity } from '#/media/store-identity.ts'

/** Explicit owned databases/media/worker only; no environment discovery or inventory transport. */
export async function researchProcessingFixture() {
  const fixture = await processingFixture({ autoStart: false })
  const root = await realpath(await mkdtemp(join(tmpdir(), 'intake-controlled-research-')))
  const mediaRoot = join(root, 'media')
  const storeId = await readMediaStoreIdentity(fixture.db.pool)
  const store = await BlobStore.initialize(mediaRoot, storeId)
  const config = Object.assign(fixture.config, {
    profileId: 'restricted-research-stub/1' as const,
    approvedSourceUrls: [] as string[],
    sourceProtectedOrigins: [] as string[],
  })
  let child: ChildProcess | undefined
  let output = ''
  let diagnostic = ''
  let workerFailure: unknown

  async function startWorker() {
    assert.equal(child, undefined)
    const configPath = join(root, 'worker.json')
    await writeFile(
      configPath,
      JSON.stringify({
        ...config,
        runnerDatabaseUrl: fixture.runner.url,
        schedulerDatabaseUrl: fixture.scheduler.url,
        mediaRoot,
        mediaStoreId: storeId,
      }),
      { mode: 0o600 },
    )
    const readyCount = (output.match(/RESEARCH_PROCESSING_READY/g) ?? []).length
    workerFailure = undefined
    child = spawn(
      process.execPath,
      ['--import', 'tsx', 'tests/fixtures/research-processing-worker.ts'],
      {
        cwd: fileURLToPath(new URL('../../', import.meta.url)),
        env: {
          PATH: process.env.PATH,
          HOME: root,
          TMPDIR: root,
          LANG: 'C.UTF-8',
          INTAKE_RESEARCH_PROCESSING_CONFIG: configPath,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      },
    )
    child.on('error', (error) => {
      workerFailure = error
    })
    child.stdout!.on('data', (bytes: Buffer) => {
      output += bytes.toString()
    })
    child.stderr!.on('data', (bytes: Buffer) => {
      diagnostic = (diagnostic + bytes.toString())
        .slice(-8192)
        .replace(/postgres(?:ql)?:\/\/[^\s"']+/g, '<private-database>')
        .replaceAll(config.channelSecret, '<private-channel>')
    })
    await processingCheckpoint(
      async () => {
        if (workerFailure || child!.exitCode !== null) {
          throw new Error(`controlled_research_worker_failed:${diagnostic}`, {
            cause: workerFailure,
          })
        }
        return output
      },
      (value) => (value.match(/RESEARCH_PROCESSING_READY/g) ?? []).length > readyCount,
    )
  }

  async function stopWorker() {
    if (!child) {
      return
    }
    const current = child
    if (current.exitCode === null && current.signalCode === null) {
      const closed = once(current, 'close')
      current.kill('SIGTERM')
      try {
        await processingCheckpoint(
          async () => current.exitCode !== null || current.signalCode !== null,
          Boolean,
          10000,
        )
      } catch (error) {
        // This detached group contains only this fixture worker and its controlled child.
        if (current.pid) {
          process.kill(-current.pid, 'SIGKILL')
        }
        await closed
        child = undefined
        throw error
      }

      await closed
    }
    assert.equal(current.exitCode, 0, diagnostic)
    child = undefined
  }

  async function start() {
    await fixture.start({ mediaStore: store })
  }

  async function dispose() {
    const results = await Promise.allSettled([stopWorker(), fixture.stop()])
    await fixture.dispose()
    await rm(root, { recursive: true, force: true })
    for (const result of results) {
      if (result.status === 'rejected') {
        throw result.reason
      }
    }
  }

  try {
    await start()
  } catch (error) {
    await dispose()
    throw error
  }
  return {
    ...fixture,
    config,
    store,
    start,
    startWorker,
    stopWorker,
    dispose,
    get output() {
      return output
    },
    get workerAlive() {
      return Boolean(child && child.exitCode === null && child.signalCode === null)
    },
  }
}
