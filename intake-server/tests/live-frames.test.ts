import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LIVE_PROTOCOL } from '@invimport/contracts'
import { sendLiveFrame } from '../src/live/frames.ts'

test('slow projection peers are terminated before a frame can exceed the bounded send queue', () => {
  let sends = 0
  let terminated = false
  const peer = {
    readyState: 1 as const,
    bufferedAmount: 65530,
    send: () => {
      sends++
    },
    terminate: () => {
      terminated = true
    },
  }
  assert.equal(sendLiveFrame(peer, { type: 'heartbeat', protocol: LIVE_PROTOCOL }), false)
  assert.equal(sends, 0)
  assert.equal(terminated, true)
  peer.bufferedAmount = 0
  assert.equal(sendLiveFrame(peer, { type: 'heartbeat', protocol: LIVE_PROTOCOL }), true)
  assert.equal(sends, 1)
})
