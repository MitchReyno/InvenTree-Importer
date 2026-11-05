import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { access, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

test(
  'explicit media root without a database refuses startup before creating files',
  { timeout: 40000 },
  async () => {
    const parent = await realpath(await mkdtemp(join(tmpdir(), 'intake-media-startup-')))
    const root = join(parent, 'must-not-be-created')
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', fileURLToPath(new URL('../src/main.ts', import.meta.url))],
      {
        env: { PATH: process.env.PATH, INTAKE_BLOB_ROOT: root },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    let output = ''
    child.stdout.on('data', (bytes) => {
      output += bytes.toString()
    })
    child.stderr.on('data', (bytes) => {
      output += bytes.toString()
    })
    const timer = setTimeout(() => child.kill('SIGTERM'), 30000)

    try {
      const [code] = await once(child, 'close')
      assert.equal(code, 1)
      assert.match(output, /media_database_required/)
      assert(!output.includes('listening on configured loopback origin'))
      await assert.rejects(access(root), { code: 'ENOENT' })
    } finally {
      clearTimeout(timer)
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM')
      }
      await rm(parent, { recursive: true, force: true })
    }
  },
)
