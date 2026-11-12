import { createContext, useContext, type ReactNode } from 'react'
import type { AttentionClient } from '#/attention/useBatchAttention'
import type { CatalogueClient } from '#/catalogue/types'
import type { MediaClient } from '#/media/types'
import type { OperatorReviewClient } from '#/operator/types'
import type { AgentsRead, ProcessingClient } from '#/processing/types'
import type { RecordsClient } from '#/records/useBatchRecords'

export function ApiClientsProvider({
  value,
  children,
}: {
  value: ApiClients
  children: ReactNode
}) {
  return <ApiClientsContext.Provider value={value}>{children}</ApiClientsContext.Provider>
}

/** Optional feature clients; an absent one means that feature is unavailable. */
export interface ApiClients {
  agents?: AgentsRead
  attention?: AttentionClient
  catalogue?: CatalogueClient
  media?: MediaClient
  operator?: OperatorReviewClient
  processing?: ProcessingClient
  records?: RecordsClient
}

const ApiClientsContext = createContext<ApiClients>({})

export function useApiClients() {
  return useContext(ApiClientsContext)
}
