import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { expect, test } from 'vitest'
import type { MediaClient } from '#/media/types'
import { ApiClientsProvider } from '#/components/clients/ApiClientsProvider'
import { useApiClients } from './api-clients'

test('outside a provider every feature client is unavailable', () => {
  const { result } = renderHook(() => useApiClients())
  expect(result.current).toEqual({})
})

test('a provided client reaches its consumers', () => {
  const media = {} as MediaClient

  const wrapper = ({ children }: { children: ReactNode }) => (
    <ApiClientsProvider value={{ media }}>{children}</ApiClientsProvider>
  )

  const { result } = renderHook(() => useApiClients(), { wrapper })
  expect(result.current.media).toBe(media)
  expect(result.current.operator).toBeUndefined()
})
