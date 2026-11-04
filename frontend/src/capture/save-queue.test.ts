import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { IntakeRequestError } from '@invimport/contracts/client'
import { SaveQueue, type LaneSpec } from './save-queue'

type Sent = { lane: string; payload: string; revision: string; key: string }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

let sent: Sent[]
let replies: ReturnType<typeof deferred<{ revision: string }>>[]
let acks: string[]

function lane(name: string): LaneSpec<string, { revision: string }> {
  return {
    send(payload, revision, key) {
      sent.push({ lane: name, payload, revision, key })
      const reply = deferred<{ revision: string }>()
      replies.push(reply)
      return reply.promise
    },
    revisionOf: (result) => result.revision,
    onAcknowledged: (_result, payload) => acks.push(`${name}:${payload}`),
  }
}

function queue() {
  const value = new SaveQueue({ revision: '1', debounceMs: 500 })
  value.register('settings', lane('settings'), 'a')
  value.register('instructions', lane('instructions'), '')
  return value
}

const settle = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => {
  vi.useFakeTimers()
  sent = []
  replies = []
  acks = []
})
afterEach(() => vi.useRealTimers())

test('valid edits wait for the idle debounce and blur flushes immediately', async () => {
  const q = queue()
  q.update('settings', 'b')
  await vi.advanceTimersByTimeAsync(499)
  expect(sent).toEqual([])
  expect(q.state().lanes.settings).toBe('pending')
  await vi.advanceTimersByTimeAsync(1)
  expect(sent).toEqual([expect.objectContaining({ payload: 'b', revision: '1' })])
  q.update('instructions', 'x')
  q.flush('instructions')
  await settle()
  expect(sent).toHaveLength(1)
  replies[0].resolve({ revision: '2' })
  await settle()
  expect(sent[1]).toMatchObject({ lane: 'instructions', payload: 'x', revision: '2' })
})

test('an invalid draft is never sent and newer valid input replaces it', async () => {
  const q = queue()
  q.invalid('settings')
  q.flush('settings')
  await vi.advanceTimersByTimeAsync(1000)
  expect(sent).toEqual([])
  expect(q.state().lanes.settings).toBe('invalid')
  expect(q.state().dirty).toBe(true)
  q.update('settings', 'c', { immediate: true })
  await settle()
  expect(sent.map((item) => item.payload)).toEqual(['c'])
})

test('newer input during an in-flight save stays unsaved until a later serialized request', async () => {
  const q = queue()
  q.update('settings', 'b', { immediate: true })
  await settle()
  q.update('settings', 'c', { immediate: true })
  await settle()
  expect(sent).toHaveLength(1)
  replies[0].resolve({ revision: '2' })
  await settle()
  expect(acks).toEqual(['settings:b'])
  expect(q.state().lanes.settings).not.toBe('saved')
  expect(sent[1]).toMatchObject({ payload: 'c', revision: '2' })
  expect(sent[1].key).not.toBe(sent[0].key)
  replies[1].resolve({ revision: '3' })
  await settle()
  expect(q.state()).toMatchObject({ revision: '3', dirty: false, lanes: { settings: 'saved' } })
})

test('returning to the saved value while a save is in flight still resends the saved value', async () => {
  const q = queue()
  q.update('settings', 'b', { immediate: true })
  await settle()
  q.update('settings', 'a', { immediate: true })
  replies[0].resolve({ revision: '2' })
  await settle()
  expect(sent.map((item) => item.payload)).toEqual(['b', 'a'])
})

test('an uncertain acknowledgement freezes the exact request and stops new commands', async () => {
  const q = queue()
  q.update('settings', 'b', { immediate: true })
  await settle()
  replies[0].reject(new TypeError('network'))
  await settle()
  expect(q.state()).toMatchObject({ blocked: 'unconfirmed', dirty: true })
  q.update('instructions', 'x', { immediate: true })
  q.update('settings', 'c', { immediate: true })
  await settle()
  expect(sent).toHaveLength(1)
  q.retry()
  await settle()
  expect(sent[1]).toEqual({ ...sent[0] })
  replies[1].resolve({ revision: '2' })
  await settle()
  expect(acks).toEqual(['settings:b'])
  expect(sent[2]).toMatchObject({ payload: 'c', revision: '2' })
})

test('a revision conflict keeps drafts and sends nothing until an explicit rebase', async () => {
  const q = queue()
  q.update('settings', 'b', { immediate: true })
  await settle()
  replies[0].reject(new IntakeRequestError(412, 'revision_conflict'))
  await settle()
  expect(q.state()).toMatchObject({ blocked: 'conflict', dirty: true })
  q.update('settings', 'c', { immediate: true })
  await settle()
  expect(sent).toHaveLength(1)
  q.rebase('5')
  await settle()
  expect(sent[1]).toMatchObject({ payload: 'c', revision: '5' })
})

test('a definite rejection is not retried until the input changes', async () => {
  const q = queue()
  q.update('settings', 'b', { immediate: true })
  await settle()
  replies[0].reject(new IntakeRequestError(400, 'invalid_reference'))
  await settle()
  expect(q.state().lanes.settings).toBe('rejected')
  await vi.advanceTimersByTimeAsync(5000)
  expect(sent).toHaveLength(1)
  q.update('settings', 'c', { immediate: true })
  await settle()
  expect(sent[1].payload).toBe('c')
})

test('disconnected queues keep drafts, report them and resume only when reconnected', async () => {
  const q = queue()
  q.setConnected(false)
  q.update('settings', 'b', { immediate: true })
  await settle()
  expect(sent).toEqual([])
  expect(q.state()).toMatchObject({ connected: false, dirty: true })
  q.setConnected(true)
  await settle()
  expect(sent.map((item) => item.payload)).toEqual(['b'])
})

test('reset adopts explicitly reloaded saved values and drops local drafts', async () => {
  const q = queue()
  q.update('settings', 'b')
  q.reset('7', { settings: 'z', instructions: 'y' })
  await vi.advanceTimersByTimeAsync(1000)
  expect(sent).toEqual([])
  expect(q.state()).toMatchObject({ revision: '7', dirty: false, blocked: null })
})

test('listeners hear every state change', async () => {
  const q = queue()
  const listener = vi.fn()
  const stop = q.subscribe(listener)
  q.update('settings', 'b', { immediate: true })
  await settle()
  expect(listener).toHaveBeenCalled()
  stop()
  listener.mockClear()
  replies[0].resolve({ revision: '2' })
  await settle()
  expect(listener).not.toHaveBeenCalled()
})

test('defer pauses a scheduled send until the lane is updated again', async () => {
  const q = queue()
  q.update('settings', 'b')
  q.defer('settings')
  await vi.advanceTimersByTimeAsync(2000)
  expect(sent).toEqual([])
  expect(q.state().dirty).toBe(true)
  q.update('settings', 'c')
  await vi.advanceTimersByTimeAsync(500)
  expect(sent.map((item) => item.payload)).toEqual(['c'])
})

test('a refused one-shot draft can be discarded so it no longer holds the queue dirty', async () => {
  const q = queue()
  q.update('settings', 'b', { immediate: true })
  await settle()
  replies[0].reject(new IntakeRequestError(415, 'unsupported_media'))
  await settle()
  expect(q.state()).toMatchObject({ dirty: true, lanes: { settings: 'rejected' } })
  q.discard('settings')
  expect(q.state()).toMatchObject({ dirty: false, lanes: { settings: 'saved' } })
})

test('an exact retry waits for the connection', async () => {
  const q = queue()
  q.update('settings', 'b', { immediate: true })
  await settle()
  replies[0].reject(new TypeError('network'))
  await settle()
  q.setConnected(false)
  q.retry()
  await settle()
  expect(sent).toHaveLength(1)
  q.setConnected(true)
  q.retry()
  await settle()
  expect(sent).toHaveLength(2)
})
