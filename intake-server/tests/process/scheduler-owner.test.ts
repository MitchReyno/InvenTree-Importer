import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { isolatedDatabase } from '../support/database.ts'
import { reownProcessingRows } from '#/dev/scheduler-owner.ts'
import { processingApplication } from '#/processing/queue.ts'

const run = promisify(execFile)

async function register(url: string, name: string) {
  const { stdout } = await run(
    process.execPath,
    ['--import', 'tsx', fileURLToPath(new URL('./queue-owner-worker.ts', import.meta.url))],
    {
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        INTAKE_QUALIFICATION_DATABASE_URL: url,
        INTAKE_QUALIFICATION_APPLICATION: name,
      },
      timeout: 60000,
    },
  )
  return stdout.trim()
}

test('a fresh scheduler database has nothing to re-own', async () => {
  const db = await isolatedDatabase({ migrate: false })
  try {
    await reownProcessingRows(db.url)
  } finally {
    await db.dispose()
  }
})

test('a retained namespace keeps its Processing queue when switching profiles', async () => {
  const db = await isolatedDatabase({ migrate: false })
  try {
    assert.equal(await register(db.url, 'bench-intake-dev-processing'), 'REGISTERED')
    assert.equal(await register(db.url, processingApplication), 'REFUSED')

    await reownProcessingRows(db.url)
    assert.equal(await register(db.url, processingApplication), 'REGISTERED')

    await reownProcessingRows(db.url)
    assert.equal(await register(db.url, processingApplication), 'REGISTERED')
  } finally {
    await db.dispose()
  }
})
