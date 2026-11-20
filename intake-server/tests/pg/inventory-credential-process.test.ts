import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { captureProcess } from '../support/capture-process.ts'

const PLANTED = 'planted-replacement-0123456789abcdef'

async function freePort() {
  const reservation = createServer()
  reservation.listen(0, '127.0.0.1')
  await once(reservation, 'listening')
  const address = reservation.address()
  assert.ok(address && typeof address !== 'string')
  reservation.close()
  await once(reservation, 'close')
  return address.port
}

test('a replaced token is used by the running server and again after a restart, and never leaves it', async (t) => {
  const parent = await mkdtemp(join(tmpdir(), 'intake-secrets-'))
  t.after(() => rm(parent, { recursive: true, force: true }))
  const h = await captureProcess(await freePort(), {
    env: { INTAKE_SECRETS_DIR: join(parent, 'secrets') },
    acceptedToken: PLANTED,
  })
  const bodies: string[] = []

  async function call(path: string, init: RequestInit = {}) {
    const response = await fetch(h.origin + path, init)
    const body = await response.text()
    bodies.push(body)
    return { status: response.status, json: () => JSON.parse(body) as Record<string, unknown> }
  }

  async function status() {
    const read = await call('/api/v1/connection-status')
    return read.json().target as Record<string, unknown>
  }

  try {
    let csrf = (await h.start()).csrf_token
    const command = (method: string, body?: unknown) =>
      call('/api/v1/inventory-credential', {
        method,
        headers: {
          origin: h.origin,
          'x-intake-csrf': csrf,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })

    // The environment token is refused, so the saved one is what makes reads work.
    const before = await status()
    assert.equal(before.failure_code, 'unauthorized')
    assert.equal(before.credential_source, 'environment')

    const refused = await command('PUT', { token: 'not-the-accepted-token' })
    assert.equal(refused.status, 422)
    const saved = await command('PUT', { token: PLANTED })
    assert.equal(saved.status, 200)
    assert.equal(saved.json().credential_source, 'saved')
    const after = await status()
    assert.equal(after.state, 'reachable')
    assert.equal(after.credential_source, 'saved')

    await h.stop()
    csrf = (await h.start()).csrf_token
    const restarted = await status()
    assert.equal(restarted.state, 'reachable')
    assert.equal(restarted.credential_source, 'saved')
    assert.equal(h.authorizations.at(-1), `Token ${PLANTED}`)

    // Every other surface the browser reads.
    await call('/api/v1/bootstrap')
    await call('/api/v1/readiness')
    await call('/api/v1/connection-status/check', {
      method: 'POST',
      headers: { origin: h.origin, 'x-intake-csrf': csrf },
    })
    await call('/api/v1/not-a-route')
    await call('/api/v1/inventory-credential', {
      method: 'PUT',
      headers: { origin: h.origin, 'x-intake-csrf': csrf, 'content-type': 'application/json' },
      body: `{"token":"${PLANTED} broken`,
    })

    const reverted = await command('DELETE')
    assert.equal(reverted.json().credential_source, 'environment')
    assert.equal((await status()).failure_code, 'unauthorized')

    for (const body of bodies) {
      assert.ok(!body.includes(PLANTED), body.slice(0, 200))
    }
    assert.ok(!h.logs().includes(PLANTED))
  } finally {
    await h.dispose()
  }
})
