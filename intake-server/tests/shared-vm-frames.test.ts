import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { Frames } from '../src/agents/shared-vm/frames.ts'

test('stream boundaries do not split or merge two dispatch messages', async () => {
  const wire = new PassThrough()
  const frames = new Frames(wire)
  const first = Buffer.from('{"ready":"π"}')
  const second = Buffer.from('{"done":true}')
  const length = (data: Buffer) => {
    const header = Buffer.alloc(4)
    header.writeUInt32BE(data.length)
    return header
  }
  const packet = Buffer.concat([length(first), first, length(second), second])
  wire.write(packet.subarray(0, 2))
  const received = frames.read()
  wire.end(packet.subarray(2))
  assert.deepEqual(await received, { ready: 'π' })
  assert.deepEqual(await frames.read(), { done: true })
})

test('oversized or truncated messages are refused before dispatch', async () => {
  const oversized = new PassThrough()
  const header = Buffer.alloc(4)
  header.writeUInt32BE(0xffffffff)
  oversized.end(header)
  await assert.rejects(new Frames(oversized).read(), /invalid_runner_frame/)
  const partial = new PassThrough()
  partial.end(Buffer.from([0, 0, 0, 3, 123]))
  await assert.rejects(new Frames(partial).read(), /runner_disconnected/)
})
