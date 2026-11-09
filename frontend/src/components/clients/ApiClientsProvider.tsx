import type { ReactNode } from 'react'
import { ApiClientsContext, type ApiClients } from '#/clients/api-clients'

export function ApiClientsProvider({
  value,
  children,
}: {
  value: ApiClients
  children: ReactNode
}) {
  return <ApiClientsContext.Provider value={value}>{children}</ApiClientsContext.Provider>
}
