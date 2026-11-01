import { act, renderHook, waitFor } from '@testing-library/react'
import { useQuery } from '@tanstack/react-query'
import { expect, test, vi } from 'vitest'
import type { ReactNode } from 'react'
import { ServerStateProvider } from './components/query/ServerStateProvider'
import { createServerQueryClient } from './queries/client'
import {
  serverQueryKey,
  serverScopeIdentity,
  useServerScope,
  type ServerScope,
} from './queries/scope'
import { fixtureScope } from './test/render'

function deferred<T>() {
  let complete: (value: T) => void = () => {
    throw new Error('deferred_not_initialized')
  }

  const promise = new Promise<T>((resolve) => {
    complete = resolve
  })

  return { promise, resolve: (value: T) => complete(value) }
}

test.each([
  { actorId: '50000000-0000-4000-8000-000000000099' },
  { origin: 'http://localhost:4000' },
  { targetId: 'a0000000-0000-4000-8000-000000000099' },
  { targetContextId: '60000000-0000-4000-8000-000000000099' },
])('private scope replacement clears old cache and ignores its late read: %j', async (changed) => {
  const firstRead = deferred<string>()
  const oldClient = createServerQueryClient()
  const newClient = createServerQueryClient()
  const read = vi.fn((scope: ServerScope) =>
    scope === fixtureScope ? firstRead.promise : Promise.resolve('New scope facts'),
  )
  let scope = fixtureScope
  let client = oldClient

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ServerStateProvider key={serverScopeIdentity(scope)} scope={scope} client={client}>
        {children}
      </ServerStateProvider>
    )
  }

  const view = renderHook(
    () => {
      const activeScope = useServerScope()
      return useQuery({
        queryKey: serverQueryKey(activeScope, 'capture', 'same-batch'),
        queryFn: () => read(activeScope),
      })
    },
    { wrapper: Wrapper },
  )
  await waitFor(() => expect(read).toHaveBeenCalledTimes(1))
  const oldKey = serverQueryKey(fixtureScope, 'capture', 'same-batch')
  oldClient.setQueryData(serverQueryKey(fixtureScope, 'retained-other-row'), 'Prior private facts')
  scope = { ...fixtureScope, ...changed }
  client = newClient
  view.rerender()
  await waitFor(() => expect(view.result.current.data).toBe('New scope facts'))
  expect(oldClient.getQueryCache().getAll()).toEqual([])
  expect(newClient.getQueryData(oldKey)).toBeUndefined()

  await act(async () => {
    firstRead.resolve('Late prior private facts')
  })
  expect(view.result.current.data).toBe('New scope facts')
  expect(oldClient.getQueryCache().getAll()).toEqual([])
  view.unmount()
  expect(newClient.getQueryCache().getAll()).toEqual([])
})
