import { useQuery, useQueryClient, type Query } from '@tanstack/react-query'
import type {
  AgentModelCatalogDto,
  AgentModelCatalogRefreshDto,
  AgentModelCatalogRefreshReceiptDto,
  AgentProviderId,
  AgentSelectionDto,
} from '@invimport/contracts'
import { useServerScope } from '#/context'
import { serverQueryKey } from '#/queries/scope'
import { catalogBusy, catalogViews } from './model-catalog'

/** How often the list is read while a read runs or it is from an earlier sign-in, at first. */
export const CATALOG_SETTLING_POLL_MS = 1000
/** How long the list is read each second before it slows down. */
export const CATALOG_SETTLING_FOR_MS = 30_000
/** How often the list is read once a read has run that long. */
export const CATALOG_SLOW_POLL_MS = 30_000
/** How often an idle list is read while a page shows it, so a change elsewhere reaches it. */
export const CATALOG_IDLE_POLL_MS = 60_000

export type ModelCatalogSource = {
  modelCatalog: () => Promise<AgentModelCatalogDto>
  refreshModelCatalog?: (
    input: AgentModelCatalogRefreshDto,
  ) => Promise<AgentModelCatalogRefreshReceiptDto>
}

/** The catalogue read, with when it started settling, if it is, for the read schedule. */
type CatalogRead = { catalog: AgentModelCatalogDto; settlingSince: number | null }

function withSchedule(catalog: AgentModelCatalogDto, previous: CatalogRead | undefined) {
  if (!catalogBusy(catalog)) {
    return { catalog, settlingSince: null }
  }

  return { catalog, settlingSince: previous?.settlingSince ?? Date.now() }
}

function readInterval(query: Query<CatalogRead>) {
  const since = query.state.data?.settlingSince
  if (since === null || since === undefined) {
    return CATALOG_IDLE_POLL_MS
  }

  return Date.now() - since < CATALOG_SETTLING_FOR_MS
    ? CATALOG_SETTLING_POLL_MS
    : CATALOG_SLOW_POLL_MS
}

/**
 * The provider's list as from an earlier sign-in until a read under the new one lands, or as
 * reading when there was none to mark. Only a list for the sign-in method that changed is marked.
 */
function markedStale(
  catalog: AgentModelCatalogDto,
  provider: AgentProviderId,
  authentication: Authentication,
) {
  const listed = catalog[provider]
  if (listed.authentication !== authentication) {
    return catalog
  }
  const state = listed.builtin ? 'reading' : 'stale_sign_in'

  return { ...catalog, [provider]: { ...listed, state } }
}

type Authentication = AgentSelectionDto['authentication']

/** Each provider's current authentication, so a list read for another one is never trusted. */
export type CatalogAuthentication = Record<AgentProviderId, Authentication>

/**
 * Each provider's model list, shared by Settings › Agents and Processing. It is read each second
 * for 30 s while a read runs or the list is from an earlier sign-in, then every 30 s while that
 * lasts, and otherwise every minute and on focus while a page shows it; a hidden tab reads it
 * when it is shown again.
 */
export function useModelCatalog(
  client: ModelCatalogSource | undefined,
  { enabled = true }: { enabled?: boolean } = {},
) {
  const scope = useServerScope()
  const queryClient = useQueryClient()
  const queryKey = serverQueryKey(scope, 'model-catalog')

  /** A read of the list; one cancelled meanwhile is never used. */
  async function readCatalog({ signal }: { signal: AbortSignal }) {
    const catalog = await client!.modelCatalog()
    if (signal.aborted) {
      throw new Error('model_catalog_read_cancelled')
    }

    return withSchedule(catalog, queryClient.getQueryData<CatalogRead>(queryKey))
  }

  const query = useQuery({
    queryKey,
    queryFn: readCatalog,
    enabled: enabled && client !== undefined,
    refetchInterval: readInterval,
    // The app turns focus reads off; this list is read on focus so a change made elsewhere shows.
    refetchOnWindowFocus: true,
  })
  const current = query.status === 'success' && query.fetchStatus !== 'paused'

  /** Check again: asks for a read, then reads the list, which says it is reading. */
  async function refresh(provider: AgentProviderId) {
    try {
      await client?.refreshModelCatalog?.({ provider })
    } catch {
      // The list's own schedule reads it again; the card keeps showing the last read.
    }
    await queryClient.invalidateQueries({ queryKey })
  }

  /**
   * A sign-in change the VM confirmed, or may have made, for the provider's `authentication`: asks
   * the server to mark that list as from an earlier sign-in, marks it so here before the read it
   * starts, and answers whether the server took it. A refusal isn't sent again: the server's own
   * sign-in check marks the list within a minute, which the sign-in dialog tells the operator.
   */
  async function signInChanged(provider: AgentProviderId, authentication: Authentication) {
    let marked = true
    try {
      await client?.refreshModelCatalog?.({ provider, authentication, invalidate: true })
    } catch {
      marked = false
    }
    // A read sent before the change may still answer with the old list as current.
    await queryClient.cancelQueries({ queryKey })
    queryClient.setQueryData<CatalogRead>(
      queryKey,
      (read) =>
        read && {
          catalog: markedStale(read.catalog, provider, authentication),
          settlingSince: read.settlingSince ?? Date.now(),
        },
    )
    void queryClient.invalidateQueries({ queryKey })

    return marked
  }

  return {
    /** Each provider's list; one answered for another sign-in method than `authentication` waits. */
    viewsFor: (authentication?: CatalogAuthentication) =>
      catalogViews(query.data?.catalog, current, authentication),
    refresh,
    signInChanged,
  }
}

export type ModelCatalogState = ReturnType<typeof useModelCatalog>
