import { createContext, useContext } from 'react'
import type { AttentionClient } from '#/attention/useBatchAttention'
import type { CatalogueClient } from '#/catalogue/types'
import type { MediaClient } from '#/media/types'
import type { OperatorReviewClient } from '#/operator/types'
import type { AgentsRead, ProcessingClient } from '#/processing/types'
import type { RecordsClient } from '#/records/useBatchRecords'

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

export const ApiClientsContext = createContext<ApiClients>({})

export function useApiClients() {
  return useContext(ApiClientsContext)
}
