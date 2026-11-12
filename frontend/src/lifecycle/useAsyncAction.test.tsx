import { act, renderHook } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { useAsyncAction } from './useAsyncAction'

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

test('is busy while the action runs and idle once it succeeds', async () => {
  const pending = deferred()
  const { result } = renderHook(() => useAsyncAction())
  expect(result.current.busy).toBe(false)

  let outcome!: Promise<string>
  act(() => {
    outcome = result.current.run(() => pending.promise, 'Not saved.')
  })
  expect(result.current.busy).toBe(true)

  await act(async () => {
    pending.resolve()
    await outcome
  })
  await expect(outcome).resolves.toBe('succeeded')
  expect(result.current.busy).toBe(false)
  expect(result.current.error).toBe('')
})

test('shows the failure text when the action throws', async () => {
  const { result } = renderHook(() => useAsyncAction())
  let outcome = ''
  await act(async () => {
    outcome = await result.current.run(() => Promise.reject(new Error('offline')), 'Not saved.')
  })
  expect(outcome).toBe('failed')
  expect(result.current.busy).toBe(false)
  expect(result.current.error).toBe('Not saved.')
})

test('a new run clears the previous failure, and a success leaves it clear', async () => {
  const pending = deferred()
  const { result } = renderHook(() => useAsyncAction())
  await act(async () => {
    await result.current.run(() => Promise.reject(new Error('offline')), 'Not saved.')
  })

  let outcome!: Promise<string>
  act(() => {
    outcome = result.current.run(() => pending.promise, 'Not saved.')
  })
  expect(result.current.error).toBe('')

  await act(async () => {
    pending.resolve()
    await outcome
  })
  expect(result.current.error).toBe('')
})

test('clearError removes the failure text', async () => {
  const { result } = renderHook(() => useAsyncAction())
  await act(async () => {
    await result.current.run(() => Promise.reject(new Error('offline')), 'Not saved.')
  })
  act(() => result.current.clearError())
  expect(result.current.error).toBe('')
})

test('a second run while one is busy is skipped without calling its action', async () => {
  const pending = deferred()
  const second = vi.fn(async () => undefined)
  const { result } = renderHook(() => useAsyncAction())

  let first!: Promise<string>
  let skipped!: Promise<string>
  act(() => {
    first = result.current.run(() => pending.promise, 'First failed.')
    // Same render as the first call, as a double click before React re-renders would be.
    skipped = result.current.run(second, 'Second failed.')
  })
  await expect(skipped).resolves.toBe('skipped')
  expect(second).not.toHaveBeenCalled()
  expect(result.current.busy).toBe(true)

  await act(async () => {
    pending.reject(new Error('offline'))
    await first
  })
  expect(result.current.busy).toBe(false)
  expect(result.current.error).toBe('First failed.')
})

test('run and clearError keep their identity across renders', async () => {
  const { result, rerender } = renderHook(() => useAsyncAction())
  const { run, clearError } = result.current
  await act(async () => {
    await run(() => Promise.reject(new Error('offline')), 'Not saved.')
  })
  rerender()
  expect(result.current.run).toBe(run)
  expect(result.current.clearError).toBe(clearError)
})
