import assert from 'node:assert/strict'
import { test } from 'node:test'
import { devListenPort } from '#/dev/listen.ts'

test('private development listener does not change browser origin authority and rejects malformed ports', () => {
  assert.equal(devListenPort('http://127.0.0.1:4330', {}), 4330)
  assert.equal(devListenPort('http://127.0.0.1:4330', { INTAKE_DEV_LISTEN_PORT: '19283' }), 19283)
  for (const selected of ['', '0', '65536', '-1', '12e3', '04330', '4330x']) {
    assert.throws(
      () => devListenPort('http://127.0.0.1:4330', { INTAKE_DEV_LISTEN_PORT: selected }),
      /invalid_dev_listen_port/,
    )
  }
})
