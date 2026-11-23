import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createSaveQueue, type SaveJob } from './save-queue'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

/** A job that records its start and finishes when told to. */
function deferredJob(log: string[], name: string, result: 'done' | 'hold' = 'done') {
  let finish = () => {}

  const job: SaveJob = () => {
    log.push(`start ${name}`)
    return new Promise((resolve) => {
      finish = () => {
        log.push(`end ${name}`)
        resolve(result)
      }
    })
  }

  return { job, finish: () => finish() }
}

test('jobs run one at a time, in the order they were queued', async () => {
  const queue = createSaveQueue()
  const log: string[] = []
  const first = deferredJob(log, 'sessions')
  const second = deferredJob(log, 'tags')
  void queue.run('sessions', first.job)
  void queue.run('tags', second.job)
  await vi.advanceTimersByTimeAsync(0)
  expect(log).toEqual(['start sessions'])
  expect(queue.snapshot().running).toBe(true)
  first.finish()
  await vi.advanceTimersByTimeAsync(0)
  expect(log).toEqual(['start sessions', 'end sessions', 'start tags'])
  second.finish()
  await vi.advanceTimersByTimeAsync(0)
  expect(queue.snapshot().running).toBe(false)
})

test('a scheduled save waits for its delay, restarts on each call, and runs once', async () => {
  const queue = createSaveQueue()
  const job = vi.fn<SaveJob>(async () => 'done')
  queue.schedule('sessions', job, 600)
  await vi.advanceTimersByTimeAsync(400)
  queue.schedule('sessions', job, 600)
  await vi.advanceTimersByTimeAsync(500)
  expect(job).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(100)
  expect(job).toHaveBeenCalledTimes(1)
})

test('an owner queued twice behind a running save runs once, building its request when it starts', async () => {
  const queue = createSaveQueue()
  const log: string[] = []
  const running = deferredJob(log, 'providers')
  void queue.run('providers', running.job)
  const job = vi.fn<SaveJob>(async () => 'done')
  void queue.run('sessions', job)
  void queue.run('sessions', job)
  running.finish()
  await vi.advanceTimersByTimeAsync(0)
  expect(job).toHaveBeenCalledTimes(1)
})

test('a held outcome pauses the queue until it is released; only its resolution runs meanwhile', async () => {
  const queue = createSaveQueue()
  const log: string[] = []
  const conflict = deferredJob(log, 'sessions', 'hold')
  void queue.run('sessions', conflict.job)
  conflict.finish()
  await vi.advanceTimersByTimeAsync(0)
  expect(queue.snapshot().held).toBe(true)

  const later = vi.fn<SaveJob>(async () => 'done')
  void queue.run('tags', later)
  await vi.advanceTimersByTimeAsync(0)
  expect(later).not.toHaveBeenCalled()

  const retry = vi.fn<SaveJob>(async () => 'done')
  void queue.run('sessions', retry, { resolving: true })
  await vi.advanceTimersByTimeAsync(0)
  expect(retry).toHaveBeenCalledTimes(1)
  expect(later).not.toHaveBeenCalled()

  queue.release('sessions')
  await vi.advanceTimersByTimeAsync(0)
  expect(later).toHaveBeenCalledTimes(1)
  expect(queue.snapshot().held).toBe(false)
})

test('flush sends every scheduled save now and waits until the queue is quiet', async () => {
  const queue = createSaveQueue()
  const log: string[] = []
  const sessions = deferredJob(log, 'sessions')
  queue.schedule('sessions', sessions.job, 600)
  queue.schedule(
    'tags',
    async () => {
      log.push('tags')
      return 'done'
    },
    600,
  )
  let flushed = false
  void queue.flush().then(() => {
    flushed = true
  })
  await vi.advanceTimersByTimeAsync(0)
  expect(log).toEqual(['start sessions'])
  expect(flushed).toBe(false)
  sessions.finish()
  await vi.advanceTimersByTimeAsync(0)
  expect(log).toEqual(['start sessions', 'end sessions', 'tags'])
  expect(flushed).toBe(true)
  // Nothing is left to fire later.
  await vi.advanceTimersByTimeAsync(1000)
  expect(log).toHaveLength(3)
})

test('flush returns while a held outcome keeps later saves waiting', async () => {
  const queue = createSaveQueue()
  void queue.run('sessions', async () => 'hold')
  await vi.advanceTimersByTimeAsync(0)
  const later = vi.fn<SaveJob>(async () => 'done')
  queue.schedule('tags', later, 600)
  await queue.flush()
  expect(later).not.toHaveBeenCalled()
  expect(queue.snapshot()).toEqual({ running: false, held: true })
})

test('dispose drops scheduled saves; the queue stays usable for a remount', async () => {
  const queue = createSaveQueue()
  const dropped = vi.fn<SaveJob>(async () => 'done')
  queue.schedule('sessions', dropped, 600)
  queue.dispose()
  await vi.advanceTimersByTimeAsync(1000)
  expect(dropped).not.toHaveBeenCalled()
  const kept = vi.fn<SaveJob>(async () => 'done')
  queue.schedule('sessions', kept, 600)
  await vi.advanceTimersByTimeAsync(600)
  expect(kept).toHaveBeenCalledTimes(1)
})

test('listeners hear each change of running and held', async () => {
  const queue = createSaveQueue()
  const listener = vi.fn()
  const unsubscribe = queue.subscribe(listener)
  const log: string[] = []
  const job = deferredJob(log, 'sessions')
  void queue.run('sessions', job.job)
  await vi.advanceTimersByTimeAsync(0)
  const before = queue.snapshot()
  job.finish()
  await vi.advanceTimersByTimeAsync(0)
  expect(listener).toHaveBeenCalled()
  // The snapshot is stable between changes, as useSyncExternalStore requires.
  expect(queue.snapshot()).toBe(queue.snapshot())
  expect(queue.snapshot()).not.toBe(before)
  unsubscribe()
})

test('a save queued behind another waits for a pause restarted meanwhile', async () => {
  const queue = createSaveQueue()
  const log: string[] = []
  const running = deferredJob(log, 'providers')
  void queue.run('providers', running.job)
  const job = vi.fn<SaveJob>(async () => 'done')
  queue.schedule('sessions', job, 600)
  await vi.advanceTimersByTimeAsync(600)
  queue.schedule('sessions', job, 600)
  running.finish()
  await vi.advanceTimersByTimeAsync(300)
  expect(job).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(300)
  expect(job).toHaveBeenCalledTimes(1)
})
