import { useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { CatalogueModelDto } from '@invimport/contracts'
import { type PickerSearch } from '#/components/ui'
import { serverQueryKey, useServerScope } from '#/queries/scope'
import type { CatalogueClient } from './types'

const CANDIDATE_STALE_MS = 5 * 60_000

/**
 * Bounded candidate snapshot plus strict search for one model. Both are scoped to the actor,
 * target and context query key, so a scope change never reuses another target's records.
 */
export function useCatalogue(
  client: CatalogueClient | undefined,
  batchId: string,
  model: CatalogueModelDto,
  enabled: boolean,
) {
  const scope = useServerScope()
  const candidates = useQuery({
    queryKey: serverQueryKey(scope, 'catalogue-candidates', batchId, model),
    queryFn: async () => {
      const result = await client!.candidates(batchId, model)
      if (result.target_context_id !== scope.targetContextId || result.model !== model) {
        throw new Error('catalogue_scope_mismatch')
      }
      return result
    },
    enabled: enabled && client !== undefined,
    staleTime: CANDIDATE_STALE_MS,
    retry: false,
  })
  const search = useCallback<PickerSearch>(
    async (query) => {
      const result = await client!.search(batchId, model, query)
      if (result.target_context_id !== scope.targetContextId || result.model !== model) {
        throw new Error('catalogue_scope_mismatch')
      }
      return {
        results: result.results,
        exact: result.exact_id.status === 'found' ? result.exact_id.record : null,
      }
    },
    [batchId, client, model, scope.targetContextId],
  )
  const unavailable = !client || candidates.isError || candidates.fetchStatus === 'paused'
  return {
    candidates: candidates.data?.candidates ?? [],
    coverage: candidates.data?.coverage ?? null,
    status: unavailable
      ? ('unavailable' as const)
      : candidates.isPending
        ? ('loading' as const)
        : ('ready' as const),
    search,
  }
}
