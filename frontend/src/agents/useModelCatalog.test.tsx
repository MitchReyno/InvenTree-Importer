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

function mount(client: ModelCatalogSource, cache = createServerQueryClient()) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ServerStateProvider scope={fixtureScope} client={cache}>
      {children}
    </ServerStateProvider>
  )

  return { cache, ...renderHook(() => useModelCatalog(client), { wrapper }) }
}

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
  expect(result.current.viewsFor().claude.warns).toBe(true)
  client.modelCatalog.mockResolvedValue(stale)
  await advance(59_000)
  expect(client.modelCatalog).toHaveBeenCalledTimes(1)
  await advance(1_100)
  expect(client.modelCatalog).toHaveBeenCalledTimes(2)
  expect(result.current.viewsFor().claude.state).toBe('stale_sign_in')
  expect(result.current.viewsFor().claude.warns).toBe(false)
  client.modelCatalog.mockResolvedValue(modelCatalog())
  await advance(1_000)
  expect(result.current.viewsFor().claude.state).toBe('current')
  expect(result.current.viewsFor().claude.warns).toBe(true)
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
  const changing = result.current.signInChanged('claude', 'subscription').then(() => {
    settled = true
  })
  await advance(0)
  expect(settled).toBe(false)
  expect(result.current.viewsFor().claude.state).toBe('current')
  ack.resolve({ provider: 'claude', authentication: 'subscription', stale_sign_in: true })
  await advance(0)
  await act(() => changing)
  expect(settled).toBe(true)
  expect(client.refreshModelCatalog).toHaveBeenCalledWith({
    provider: 'claude',
    authentication: 'subscription',
    invalidate: true,
  })
  // The read it started is still held, and the view already shows the list as stale.
  expect(client.modelCatalog).toHaveBeenCalledTimes(2)
  expect(result.current.viewsFor().claude.state).toBe('stale_sign_in')
  expect(result.current.viewsFor().claude.warns).toBe(false)
  held.resolve(stale)
  await advance(0)
  expect(result.current.viewsFor().claude.state).toBe('stale_sign_in')
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
  expect(result.current.viewsFor().claude.state).toBe('reading')
})

test('a list that couldn’t be read raises no warning, from the last read or the built-in list', async () => {
  const client = source(modelCatalog())
  client.modelCatalog.mockRejectedValue(new Error('offline'))
  const { result } = mount(client)
  await advance(0)
  expect(result.current.viewsFor().claude).toMatchObject({
    state: 'unavailable',
    builtin: true,
    warns: false,
  })
})

test('a refused invalidation keeps the list marked and is sent again until the server takes it', async () => {
  const client = source(modelCatalog())
  const { result } = mount(client)
  await advance(0)
  client.refreshModelCatalog.mockRejectedValueOnce(new Error('offline'))
  client.refreshModelCatalog.mockRejectedValueOnce(new Error('offline'))
  await act(() => result.current.signInChanged('claude', 'subscription'))
  await advance(0)
  // The server still answers the old list as current; this view keeps it marked.
  expect(result.current.viewsFor().claude.state).toBe('stale_sign_in')
  expect(result.current.viewsFor().claude.warns).toBe(false)
  await advance(1_100)
  expect(client.refreshModelCatalog).toHaveBeenCalledTimes(3)
  expect(client.refreshModelCatalog).toHaveBeenLastCalledWith({
    provider: 'claude',
    authentication: 'subscription',
    invalidate: true,
  })
  // Acknowledged now: the server's own state governs again.
  expect(result.current.viewsFor().claude.state).toBe('current')
})

test('a list read for another sign-in method offers nothing until the saved one’s is read', async () => {
  const client = source(modelCatalog())
  const { result } = mount(client)
  await advance(0)
  expect(
    result.current.viewsFor({ claude: 'subscription', codex: 'subscription' }).claude.warns,
  ).toBe(true)
  expect(
    result.current.viewsFor({ claude: 'api_key', codex: 'subscription' }).claude,
  ).toMatchObject({ waiting: true, warns: false })
})

test('a view that can’t send a refused invalidation leaves it, and the list marked, for one that can', async () => {
  const cache = createServerQueryClient()

  const wrapper = ({ children }: { children: ReactNode }) => (
    <ServerStateProvider scope={fixtureScope} client={cache}>
      {children}
    </ServerStateProvider>
  )

  const settings = source(modelCatalog())
  settings.refreshModelCatalog.mockRejectedValue(new Error('offline'))
  const view = renderHook(({ client }: { client: ModelCatalogSource }) => useModelCatalog(client), {
    wrapper,
    initialProps: { client: settings as ModelCatalogSource },
  })
  await advance(0)
  await act(() => view.result.current.signInChanged('claude', 'subscription'))
  // Processing reads the same list without the refresh request.
  view.rerender({ client: { modelCatalog: async () => modelCatalog() } })
  await act(() => cache.refetchQueries())
  await advance(1_100)
  expect(view.result.current.viewsFor().claude.state).toBe('stale_sign_in')
})

test('a read sent before a refused change never settles it, even if it says the list is stale', async () => {
  const client = source(modelCatalog())
  const { result } = mount(client)
  await advance(0)
  const held = deferred<AgentModelCatalogDto>()
  client.modelCatalog.mockReturnValueOnce(held.promise)
  void result.current.refresh('codex')
  await advance(0)
  client.refreshModelCatalog.mockRejectedValue(new Error('offline'))
  await act(() => result.current.signInChanged('claude', 'subscription'))
  // The earlier read answers late, under the sign-in before this change.
  held.resolve(stale)
  await advance(0)
  client.modelCatalog.mockResolvedValue(modelCatalog())
  await advance(1_100)
  expect(result.current.viewsFor().claude.state).toBe('stale_sign_in')
})

test('a change to the subscription leaves an API key’s list as it is', async () => {
  const client = source(
    modelCatalog({ claude: providerCatalog(CLAUDE_MODELS, { authentication: 'api_key' }) }),
  )
  const { result } = mount(client)
  await advance(0)
  client.modelCatalog.mockReturnValue(new Promise(() => {}))
  await act(() => result.current.signInChanged('claude', 'subscription'))
  expect(client.refreshModelCatalog).toHaveBeenCalledWith({
    provider: 'claude',
    authentication: 'subscription',
    invalidate: true,
  })
  expect(result.current.viewsFor().claude.state).toBe('current')
})

test('an acknowledgement that answers a cancelled read settles nothing', async () => {
  const client = source(modelCatalog())
  const { result, cache } = mount(client)
  await advance(0)
  const ack = deferred<Awaited<ReturnType<typeof client.refreshModelCatalog>>>()
  client.refreshModelCatalog
    .mockRejectedValueOnce(new Error('offline'))
    .mockReturnValueOnce(ack.promise)
  await act(() => result.current.signInChanged('claude', 'subscription'))
  // The read that follows resends the change; it is cancelled before the server answers.
  await advance(0)
  expect(client.refreshModelCatalog).toHaveBeenCalledTimes(2)
  await act(() => cache.cancelQueries())
  ack.resolve({ provider: 'claude', authentication: 'subscription', stale_sign_in: true })
  // The next read's resend is refused, and the server still answers the old list as current.
  client.refreshModelCatalog.mockRejectedValue(new Error('offline'))
  client.modelCatalog.mockResolvedValue(modelCatalog())
  await act(() => cache.refetchQueries())
  await advance(0)
  expect(result.current.viewsFor().claude.state).toBe('stale_sign_in')
})

test('an older change answering late never replaces or brings back a newer one', async () => {
  const client = source(modelCatalog())
  const { result } = mount(client)
  await advance(0)
  const older = deferred<Awaited<ReturnType<typeof client.refreshModelCatalog>>>()
  client.refreshModelCatalog.mockReturnValueOnce(older.promise)
  const first = result.current.signInChanged('claude', 'subscription')
  client.refreshModelCatalog.mockRejectedValueOnce(new Error('offline'))
  await act(() => result.current.signInChanged('claude', 'subscription'))
  // The newer change is acknowledged when it is resent, and the server has read the new list.
  client.refreshModelCatalog.mockResolvedValue({
    provider: 'claude',
    authentication: 'subscription',
    stale_sign_in: true,
  })
  client.modelCatalog.mockResolvedValue(modelCatalog())
  await advance(1_100)
  expect(result.current.viewsFor().claude.state).toBe('current')
  // The older change's refusal arrives last, while the server can't be reached.
  client.refreshModelCatalog.mockRejectedValue(new Error('offline'))
  older.reject(new Error('offline'))
  await act(() => first)
  await advance(1_100)
  expect(result.current.viewsFor().claude.state).toBe('current')
})

test('a late answer to a closed dialog never lets a newer refused change go unmarked', async () => {
  const client = source(modelCatalog())
  const { result } = mount(client)
  await advance(0)
  const newer = deferred<Awaited<ReturnType<typeof client.refreshModelCatalog>>>()
  const late = deferred<Awaited<ReturnType<typeof client.refreshModelCatalog>>>()
  client.refreshModelCatalog.mockReturnValueOnce(newer.promise).mockReturnValueOnce(late.promise)
  client.modelCatalog.mockReturnValue(new Promise(() => {}))
  const saved = result.current.signInChanged('claude', 'subscription')
  void result.current.signInChanged('claude', 'subscription', { late: true })
  newer.reject(new Error('offline'))
  await act(() => saved)
  await advance(0)
  expect(result.current.viewsFor().claude.state).toBe('stale_sign_in')
})
