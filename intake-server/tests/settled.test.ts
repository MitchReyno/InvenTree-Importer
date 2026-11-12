import assert from 'node:assert/strict'
import { EventEmitter, once } from 'node:events'
import test from 'node:test'
import { settled } from '../src/events/settled.ts'

test('a rejection the handler did not catch reaches onEscape with the event arguments', async () => {
  const emitter = new EventEmitter()
  const failure = new Error('handler_failed')
  const escaped = once(emitter, 'escaped')
  emitter.on(
    'message',
    settled(
      async (_value: string) => {
        throw failure
      },
      (error, value) => emitter.emit('escaped', error, value),
    ),
  )

  emitter.emit('message', 'payload')

  assert.deepEqual(await escaped, [failure, 'payload'])
})

test('a handler that settles normally never calls onEscape', async () => {
  const emitter = new EventEmitter()
  const handled: string[] = []
  let escapes = 0
  emitter.on(
    'message',
    settled(
      async (value: string) => {
        await Promise.resolve()
        handled.push(value)
      },
      () => {
        escapes++
      },
    ),
  )

  emitter.emit('message', 'payload')
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(handled, ['payload'])
  assert.equal(escapes, 0)
})
