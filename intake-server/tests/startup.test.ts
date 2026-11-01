import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'

test('actual web entry point restarts with stable development attribution and a rotated CSRF token', { timeout: 20000 }, async () => {
  const reservation = createServer()
  reservation.listen(0, '127.0.0.1')
  await once(reservation, 'listening')
  const address = reservation.address()
  assert(address && typeof address !== 'string')
  const port = address.port
  await new Promise<void>(resolve => reservation.close(() => resolve()))
  const origin = `http://127.0.0.1:${port}`
  async function boot() {
    const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('../src/main.ts', import.meta.url))], {
      env: { PATH: process.env.PATH, INTAKE_ORIGIN: origin, INTAKE_ACTOR_ID: '00000000-0000-4000-8000-000000000009', INTAKE_CREDENTIAL_REF: 'restart-fixture', INTAKE_DEV_API_KEY: 'fake-process-only' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', value => { output += String(value) })
    child.stderr.on('data', value => { output += String(value) })
    try {
      const deadline = Date.now() + 5000
      while (!output.includes('listening on configured loopback origin')) {
        assert.equal(child.exitCode, null, 'web process exited before readiness')
        assert(Date.now() < deadline, 'web process readiness timeout')
        await new Promise(resolve => setTimeout(resolve, 25))
      }
      const response = await fetch(`${origin}/api/v1/bootstrap`, { signal: AbortSignal.timeout(2000) })
      assert.equal(response.status, 200)
      const body = await response.json()
      assert.equal(body.actor_id, '00000000-0000-4000-8000-000000000009')
      assert.equal(body.target_id, '00000000-0000-4000-8000-000000000002')
      assert.equal(body.target_context_id, '00000000-0000-4000-8000-000000000003')
      assert.equal(body.status, 'configured')
      assert.equal(body.mutation_enabled, false)
      assert.match(body.csrf_token, /^[0-9a-f]{64}$/)
      assert(!JSON.stringify(body).includes('fake-process-only'))
      return body
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit')
        child.kill('SIGTERM')
        await exited
      }
    }
  }
  const first = await boot(), second = await boot()
  assert.notEqual(first.csrf_token, second.csrf_token)
})
