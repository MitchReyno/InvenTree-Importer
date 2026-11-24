import { onlineManager, QueryObserver, type QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { deferred } from '#/test/deferred'
import { createServerQueryClient } from './client'
import { cancelVerified, freshReads, readReplacingCancels } from './fresh-reads'
import {
  REPLACED_READ_WAIT_MS,
  REPLACEMENT_START_MS,
  ReadAbandoned,
  ReadUnavailable,
} from './replaced-reads'

const scopeKey = ['intake', 'fixture']
const key = [...scopeKey, 'capture']

/** Reads the test settles one by one, in the order they started. */
function scriptedReads() {
  const pending: ReturnType<typeof deferred<{ value: string }>>[] = []
  const read = vi.fn(() => {
    const next = deferred<{ value: string }>()
    pending.push(next)
    return next.promise
  })
  return { read, pending }
}

let client: QueryClient

/** An observer of the key, as a mounted page is, so reconciliation's invalidation refetches it. */
function observe(read: () => Promise<{ value: string }>) {
  const registry = freshReads(client)
  const mountOrder = registry.nextOrder()
  const observer = new QueryObserver(client, {
    queryKey: key,
    queryFn: registry.track(key, () => read()),
  })
  const unsubscribe = observer.subscribe(() => undefined)
  return { observer, mountOrder, unsubscribe }
}

/**
 * What `LiveUpdates` does for a hint: cancel through the registry, then invalidate the scope. It
 * awaits the invalidation's reads too, which the test settles later.
 */
async function reconcile() {
  await cancelVerified(client, { queryKey: scopeKey }, { silent: true })
  void client.invalidateQueries({ queryKey: scopeKey })
  await vi.advanceTimersByTimeAsync(0)
}

function awaitedRead(
  observer: QueryObserver<{ value: string }>,
  signal = new AbortController().signal,
) {
  return readReplacingCancels({
    client,
    queryKey: key,
    read: async () => (await observer.refetch({ throwOnError: true })).data!,
    signal,
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  client = createServerQueryClient()
  freshReads(client).attach()
})

afterEach(() => {
  freshReads(client).detach()
  client.clear()
  vi.useRealTimers()
})

test('a read live reconciliation cancels resolves with the read that replaced it', async () => {
  const { read, pending } = scriptedReads()
  const { observer, mountOrder } = observe(read)
  pending[0].resolve({ value: 'first' })
  await vi.advanceTimersByTimeAsync(0)

  const awaited = awaitedRead(observer)
  expect(pending).toHaveLength(2)
  await reconcile()
  expect(pending).toHaveLength(3)
  pending[2].resolve({ value: 'replacement' })

  await expect(awaited).resolves.toEqual({ value: 'replacement' })
  // The cancelled request lands late and is never adopted; the replacement verifies.
  pending[1].resolve({ value: 'cancelled' })
  await vi.advanceTimersByTimeAsync(0)
  expect(client.getQueryData(key)).toEqual({ value: 'replacement' })
  expect(freshReads(client).verified(key, mountOrder)).toBe(true)
  expect(freshReads(client).adoptedOrder(key)).toBeGreaterThan(mountOrder + 1)
})

test('the cancelled request never verifies, even while the replacement is still running', async () => {
  const { read, pending } = scriptedReads()
  const { observer } = observe(read)
  pending[0].resolve({ value: 'first' })
  await vi.advanceTimersByTimeAsync(0)
  // A page mounted after the first read: only a read it saw start verifies it.
  const lateMount = freshReads(client).nextOrder()

  const awaited = awaitedRead(observer)
  await reconcile()
  pending[1].resolve({ value: 'cancelled' })
  await vi.advanceTimersByTimeAsync(0)
  expect(freshReads(client).verified(key, lateMount)).toBe(false)

  pending[2].resolve({ value: 'replacement' })
  await expect(awaited).resolves.toEqual({ value: 'replacement' })
  expect(freshReads(client).verified(key, lateMount)).toBe(true)
})

test('a replacing read that fails reports the read unavailable', async () => {
  const { read, pending } = scriptedReads()
  const { observer } = observe(read)
  pending[0].resolve({ value: 'first' })
  await vi.advanceTimersByTimeAsync(0)

  const awaited = awaitedRead(observer)
  const outcome = expect(awaited).rejects.toMatchObject({
    name: 'ReadUnavailable',
    reason: 'failed',
  })
  await reconcile()
  pending[2].reject(new Error('server_unreachable'))
  await outcome
  expect(freshReads(client).unavailableSinceRead(key)).toBe(true)
})

test('a replacing read that does not settle in 10 s reports the read unavailable', async () => {
  const { read, pending } = scriptedReads()
  const { observer } = observe(read)
  pending[0].resolve({ value: 'first' })
  await vi.advanceTimersByTimeAsync(0)

  const awaited = awaitedRead(observer)
  const outcome = expect(awaited).rejects.toBeInstanceOf(ReadUnavailable)
  await reconcile()
  await vi.advanceTimersByTimeAsync(REPLACED_READ_WAIT_MS - 1)
  let settled = false
  void awaited.catch(() => {
    settled = true
  })
  await vi.advanceTimersByTimeAsync(0)
  expect(settled).toBe(false)
  await vi.advanceTimersByTimeAsync(1)
  await outcome
  await expect(awaited).rejects.toMatchObject({ reason: 'timeout' })
})

test('a second cancel inside the window keeps waiting under the first deadline', async () => {
  const { read, pending } = scriptedReads()
  const { observer } = observe(read)
  pending[0].resolve({ value: 'first' })
  await vi.advanceTimersByTimeAsync(0)

  const awaited = awaitedRead(observer)
  let outcome: unknown
  awaited.then(
    (value) => (outcome = value),
    (error: unknown) => (outcome = error),
  )
  await reconcile()
  await vi.advanceTimersByTimeAsync(6000)
  // Another hint cancels the replacement and starts a third read.
  await reconcile()
  expect(pending).toHaveLength(4)
  expect(outcome).toBeUndefined()
  await vi.advanceTimersByTimeAsync(REPLACED_READ_WAIT_MS - 6000)
  expect(outcome).toBeInstanceOf(ReadUnavailable)
  expect(outcome).toMatchObject({ reason: 'timeout' })
})

test('a second cancel followed by a replacement that lands resolves with it', async () => {
  const { read, pending } = scriptedReads()
  const { observer } = observe(read)
  pending[0].resolve({ value: 'first' })
  await vi.advanceTimersByTimeAsync(0)

  const awaited = awaitedRead(observer)
  await reconcile()
  await reconcile()
  pending[3].resolve({ value: 'third' })
  await expect(awaited).resolves.toEqual({ value: 'third' })
})

test('a cancelled read with no replacement started reads again itself', async () => {
  const { read, pending } = scriptedReads()
  const { observer } = observe(read)
  pending[0].resolve({ value: 'first' })
  await vi.advanceTimersByTimeAsync(0)

  const awaited = awaitedRead(observer)
  // A cancel with no invalidation after it, as for a key nothing else reads.
  await cancelVerified(client, { queryKey: scopeKey }, { silent: true })
  await vi.advanceTimersByTimeAsync(REPLACEMENT_START_MS - 1)
  expect(pending).toHaveLength(2)
  await vi.advanceTimersByTimeAsync(1)
  expect(pending).toHaveLength(3)
  pending[2].resolve({ value: 'own read' })
  await expect(awaited).resolves.toEqual({ value: 'own read' })
})

test('a cache write while waiting is not the replacement', async () => {
  const { read, pending } = scriptedReads()
  const { observer } = observe(read)
  pending[0].resolve({ value: 'first' })
  await vi.advanceTimersByTimeAsync(0)

  const awaited = awaitedRead(observer)
  let outcome: unknown
  void awaited.then((value) => (outcome = value))
  await reconcile()
  client.setQueryData(key, { value: 'written' })
  await vi.advanceTimersByTimeAsync(0)
  expect(outcome).toBeUndefined()
  pending[2].resolve({ value: 'replacement' })
  await expect(awaited).resolves.toEqual({ value: 'replacement' })
})

test('removing the query or changing scope abandons the wait and starts no read', async () => {
  const { read, pending } = scriptedReads()
  const { observer, unsubscribe } = observe(read)
  pending[0].resolve({ value: 'first' })
  await vi.advanceTimersByTimeAsync(0)

  const awaited = awaitedRead(observer)
  const outcome = expect(awaited).rejects.toBeInstanceOf(ReadAbandoned)
  await cancelVerified(client, { queryKey: scopeKey }, { silent: true })
  unsubscribe()
  // A scope change clears the old client's cache.
  client.clear()
  await outcome
  await vi.advanceTimersByTimeAsync(REPLACED_READ_WAIT_MS)
  expect(pending).toHaveLength(2)
})

test('a removal that cancels the read itself abandons the wait', async () => {
  const { read, pending } = scriptedReads()
  const { observer, unsubscribe } = observe(read)
  pending[0].resolve({ value: 'first' })
  await vi.advanceTimersByTimeAsync(0)

  const awaited = awaitedRead(observer)
  unsubscribe()
  client.removeQueries({ queryKey: key })
  await expect(awaited).rejects.toBeInstanceOf(ReadAbandoned)
  await vi.advanceTimersByTimeAsync(REPLACED_READ_WAIT_MS)
  expect(pending).toHaveLength(2)
})

test('a caller that unmounts while another observer keeps the query stops waiting', async () => {
  const { read, pending } = scriptedReads()
  const { observer } = observe(read)
  pending[0].resolve({ value: 'first' })
  await vi.advanceTimersByTimeAsync(0)
  const caller = new AbortController()

  const awaited = awaitedRead(observer, caller.signal)
  const outcome = expect(awaited).rejects.toBeInstanceOf(ReadAbandoned)
  // Cancelled with nothing to replace it, then the caller leaves before its own read would start.
  await cancelVerified(client, { queryKey: scopeKey }, { silent: true })
  caller.abort()
  await outcome
  await vi.advanceTimersByTimeAsync(REPLACED_READ_WAIT_MS)
  expect(pending).toHaveLength(2)
  expect(client.getQueryCache().find({ queryKey: key })).toBeDefined()
})

test('a read that fails on its own keeps its own error', async () => {
  const { read, pending } = scriptedReads()
  const { observer } = observe(read)
  pending[0].resolve({ value: 'first' })
  await vi.advanceTimersByTimeAsync(0)

  const awaited = awaitedRead(observer)
  const failure = new Error('read_refused')
  pending[1].reject(failure)
  await expect(awaited).rejects.toBe(failure)
})

test('a replacement that runs out of time leaves the shown read unverified until a newer read lands', async () => {
  const { read, pending } = scriptedReads()
  const { observer, mountOrder } = observe(read)
  pending[0].resolve({ value: 'first' })
  await vi.advanceTimersByTimeAsync(0)
  expect(freshReads(client).verified(key, mountOrder)).toBe(true)

  const awaited = awaitedRead(observer)
  const outcome = expect(awaited).rejects.toMatchObject({ reason: 'timeout' })
  await reconcile()
  await vi.advanceTimersByTimeAsync(REPLACED_READ_WAIT_MS)
  await outcome
  // Commands with a revision wait again, and the key reads as unavailable.
  expect(freshReads(client).verified(key, mountOrder)).toBe(false)
  expect(freshReads(client).unavailableSinceRead(key)).toBe(true)

  pending[2].resolve({ value: 'late replacement' })
  await vi.advanceTimersByTimeAsync(0)
  expect(freshReads(client).verified(key, mountOrder)).toBe(true)
  expect(freshReads(client).unavailableSinceRead(key)).toBe(false)
})

test('a caller that leaves before any cancel stops waiting, and a late answer reaches nothing', async () => {
  const { read, pending } = scriptedReads()
  const { observer } = observe(read)
  pending[0].resolve({ value: 'first' })
  await vi.advanceTimersByTimeAsync(0)
  const caller = new AbortController()

  const awaited = awaitedRead(observer, caller.signal)
  let outcome: unknown
  awaited.then(
    (value) => (outcome = value),
    (error: unknown) => (outcome = error),
  )
  caller.abort()
  await vi.advanceTimersByTimeAsync(0)
  expect(outcome).toBeInstanceOf(ReadAbandoned)
  pending[1].resolve({ value: 'late' })
  await vi.advanceTimersByTimeAsync(0)
  expect(outcome).toBeInstanceOf(ReadAbandoned)
})

test('a read that pauses reports the read unavailable without waiting', async () => {
  onlineManager.setOnline(false)
  try {
    const observer = new QueryObserver<{ value: string }>(client, {
      queryKey: key,
      queryFn: () => new Promise<{ value: string }>(() => undefined),
      networkMode: 'online',
    })
    const unsubscribe = observer.subscribe(() => undefined)
    await vi.advanceTimersByTimeAsync(0)
    const awaited = awaitedRead(observer)
    await expect(awaited).rejects.toMatchObject({ name: 'ReadUnavailable', reason: 'paused' })
    unsubscribe()
  } finally {
    onlineManager.setOnline(true)
  }
})
