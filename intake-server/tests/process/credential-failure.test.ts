import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

// Capture both output streams of the real management handler, including unexpected errors.
test('failed guest removal preserves the revision and keeps the database error out of replies and logs', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'guest-credential-failure-'))
  const key = randomBytes(32).toString('hex')
  const origin = 'https://operator.example'
  const child = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      `
    import { managementServer } from './src/agents/shared-vm/credential-http.ts'
    const server = managementServer(process.argv[1], process.argv[2], process.env.TEST_OPERATOR)
    server.listen(0, '127.0.0.1', () => process.send(server.address().port))
  `,
      dir,
      origin,
    ],
    {
      env: { PATH: process.env.PATH, TEST_OPERATOR: key },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    },
  )
  const exited = once(child, 'close')
  let logs = ''
  child.stdout!.on('data', (bytes) => {
    logs += bytes
  })
  child.stderr!.on('data', (bytes) => {
    logs += bytes
  })
  t.after(async () => {
    child.kill()
    await exited
    await rm(dir, { recursive: true, force: true })
  })
  const [port] = await Promise.race([
    once(child, 'message'),
    exited.then(() => {
      throw new Error('management_start_failed')
    }),
  ])
  const url = 'http://127.0.0.1:' + port + '/personal-runner/claude'
  const token = 'sk-ant-oat01-' + randomBytes(24).toString('hex')
  const command = async (body: object, expected = 200) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { origin, authorization: 'Bearer ' + key, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const text = await response.text()
    assert.equal(text.includes(token), false)
    assert.equal(response.status, expected)
    return JSON.parse(text)
  }
  const first = await command({ action: 'status' })
  const saved = await command({ action: 'save', revision: first.revision, token })
  const db = new DatabaseSync(join(dir, 'claude.sqlite'))
  try {
    db.exec(
      `CREATE TRIGGER fixture_error BEFORE UPDATE ON credential BEGIN SELECT RAISE(ABORT, '${token}'); END`,
    )
    assert.deepEqual(await command({ action: 'remove', revision: saved.revision }, 503), {})
    assert.deepEqual(await command({ action: 'status' }), saved)
    db.exec('DROP TRIGGER fixture_error')
  } finally {
    db.close()
  }
  const removed = await command({ action: 'remove', revision: saved.revision })
  assert.equal(removed.configured, false)
  child.kill()
  await exited
  assert.equal(logs.includes(token), false)
  assert.equal(logs.includes(key), false)
})
