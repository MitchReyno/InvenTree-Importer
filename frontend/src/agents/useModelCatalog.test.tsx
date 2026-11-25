import { act, renderHook } from '@testing-library/react'
import { focusManager } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { AgentModelCatalogDto } from '@invimport/contracts'
import { ServerStateProvider } from '#/components/query/ServerStateProvider'
import { createServerQueryClient } from '#/queries/client'
import { deferred } from '#/test/deferred'
import { fixtureScope } from '#/test/render'
import { CLAUDE_MODELS, modelCatalog, providerCatalog } from '#/test/model-catalog'
import { useModelCatalog, type ModelCatalogSource } from './useModelCatalog'

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false })
})

afterEach(() => {
  focusManager.setFocused(undefined)
  vi.useRealTimers()
})

const stale = modelCatalog({ claude: providerCatalog(CLAUDE_MODELS, { state: 'stale_sign_in' }) })
const reading = modelCatalog({ claude: providerCatalog(CLAUDE_MODELS, { state: 'reading' }) })

function source(first: AgentModelCatalogDto) {
  return {
    modelCatalog: vi.fn(async () => first),
    refreshModelCatalog: vi.fn(async () => ({
      provider: 'claude' as const,
      authentication: 'subscription' as const,
      stale_sign_in: true,
    })),
  } satisfies ModelCatalogSource
}

function mount(client: ModelCatalogSource) {
  const cache = createServerQueryClient()

  const wrapper = ({ children }: { children: ReactNode }) => (
    <ServerStateProvider scope={fixtureScope} client={cache}>
      {children}
    </ServerStateProvider>
  )

  return renderHook(() => useModelCatalog(client), { wrapper })
}

/** Moves the clock on, then lets the reads it started answer and render. */
async function advance(ms: number) {
  await act(() => vi.advanceTimersByTimeAsync(ms))
  for (let turn = 0; turn < 3; turn++) {
    await act(() => vi.advanceTimersByTimeAsync(0))
  }
}

test('reads each second for 30 s while a read runs, then every 30 s while it lasts', async () => {
  const client = source(reading)
  mount(client)
  await advance(0)
  expect(client.modelCatalog).toHaveBeenCalledTimes(1)
  await advance(29_000)
  expect(client.modelCatalog).toHaveBeenCalledTimes(30)
  await advance(5_000)
  expect(client.modelCatalog).toHaveBeenCalledTimes(31)
  await advance(30_000)
  expect(client.modelCatalog).toHaveBeenCalledTimes(32)
})

test('a view that opened on a current list learns of a stale one, and its recovery, within a minute', async () => {
  const client = source(modelCatalog())
  const { result } = mount(client)
  await advance(0)
  expect(result.current.views.claude.warns).toBe(true)
  client.modelCatalog.mockResolvedValue(stale)
  await advance(59_000)
  expect(client.modelCatalog).toHaveBeenCalledTimes(1)
  await advance(1_100)
  expect(client.modelCatalog).toHaveBeenCalledTimes(2)
  expect(result.current.views.claude.state).toBe('stale_sign_in')
  expect(result.current.views.claude.warns).toBe(false)
  client.modelCatalog.mockResolvedValue(modelCatalog())
  await advance(1_000)
  expect(result.current.views.claude.state).toBe('current')
  expect(result.current.views.claude.warns).toBe(true)
})

test('focus reads the list before the minute is up, and a hidden tab reads it once shown again', async () => {
  const client = source(modelCatalog())
  mount(client)
  await advance(0)
  act(() => focusManager.setFocused(false))
  act(() => focusManager.setFocused(true))
  await advance(0)
  expect(client.modelCatalog).toHaveBeenCalledTimes(2)
  // Hidden, the minute passes with no read; shown again, it reads.
  act(() => focusManager.setFocused(false))
  await advance(120_000)
  expect(client.modelCatalog).toHaveBeenCalledTimes(2)
  act(() => focusManager.setFocused(true))
  await advance(0)
  expect(client.modelCatalog).toHaveBeenCalledTimes(3)
})

test('a sign-in change marks the list stale once the server acknowledges it, before its read lands', async () => {
  const client = source(modelCatalog())
  const { result } = mount(client)
  await advance(0)
  const ack = deferred<Awaited<ReturnType<typeof client.refreshModelCatalog>>>()
  const held = deferred<AgentModelCatalogDto>()
  client.refreshModelCatalog.mockReturnValue(ack.promise)
  client.modelCatalog.mockReturnValue(held.promise)
  let settled = false
  const changing = result.current.signInChanged('claude').then(() => {
    settled = true
  })
  await advance(0)
  expect(settled).toBe(false)
  expect(result.current.views.claude.state).toBe('current')
  ack.resolve({ provider: 'claude', authentication: 'subscription', stale_sign_in: true })
  await advance(0)
  await act(() => changing)
  expect(settled).toBe(true)
  expect(client.refreshModelCatalog).toHaveBeenCalledWith({ provider: 'claude', invalidate: true })
  // The read it started is still held, and the view already shows the list as stale.
  expect(client.modelCatalog).toHaveBeenCalledTimes(2)
  expect(result.current.views.claude.state).toBe('stale_sign_in')
  expect(result.current.views.claude.warns).toBe(false)
  held.resolve(stale)
  await advance(0)
  expect(result.current.views.claude.state).toBe('stale_sign_in')
})

test('Check again asks for a read and reads the list again', async () => {
  const client = source(modelCatalog())
  const { result } = mount(client)
  await advance(0)
  client.modelCatalog.mockResolvedValue(reading)
  await act(() => result.current.refresh('claude'))
  expect(client.refreshModelCatalog).toHaveBeenCalledExactlyOnceWith({ provider: 'claude' })
  expect(client.modelCatalog).toHaveBeenCalledTimes(2)
  await advance(0)
  expect(result.current.views.claude.state).toBe('reading')
})

test('a list that couldn’t be read raises no warning, from the last read or the built-in list', async () => {
  const client = source(modelCatalog())
  client.modelCatalog.mockRejectedValue(new Error('offline'))
  const { result } = mount(client)
  await advance(0)
  expect(result.current.views.claude).toMatchObject({
    state: 'unavailable',
    builtin: true,
    warns: false,
  })
})
