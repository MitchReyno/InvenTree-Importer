import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { expect, test, vi } from 'vitest'
import { ServerStateProvider } from '#/components/query/ServerStateProvider'
import { fixtureScope } from '#/test/render'
import type { CatalogueClient } from './types'
import { useCatalogue } from './useCatalogue'

function Wrapper({ children }: { children: ReactNode }) {
  return <ServerStateProvider scope={fixtureScope}>{children}</ServerStateProvider>
}

test('a picker search passes its abort signal to the catalogue client', async () => {
  const search = vi.fn<CatalogueClient['search']>(
    (_batch, _model, _query, signal) =>
      new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
      }),
  )
  const client = { search, candidates: vi.fn() } as unknown as CatalogueClient
  const { result } = renderHook(() => useCatalogue(client, 'batch', 'location', false), {
    wrapper: Wrapper,
  })
  const controller = new AbortController()
  const reason = new Error('search_superseded')

  const pending = result.current.search('Drawer', controller.signal)
  controller.abort(reason)

  expect(search).toHaveBeenCalledWith('batch', 'location', 'Drawer', controller.signal)
  await expect(pending).rejects.toBe(reason)
})
