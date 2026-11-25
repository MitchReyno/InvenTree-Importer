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
 * reading when there was none to mark.
 */
function markedStale(catalog: AgentModelCatalogDto, provider: AgentProviderId) {
  const listed = catalog[provider]
  const state = listed.builtin ? 'reading' : 'stale_sign_in'

  return { ...catalog, [provider]: { ...listed, state } }
}

/** Providers whose sign-in changed but whose invalidation the server hasn't acknowledged yet. */
type Unacknowledged = readonly AgentProviderId[]

const NONE: Unacknowledged = []

/** Each provider's current authentication, so a list read for another one is never trusted. */
export type CatalogAuthentication = Record<AgentProviderId, AgentSelectionDto['authentication']>

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
  const pendingKey = serverQueryKey(scope, 'model-catalog', 'unacknowledged')
  // Kept beside the read rather than in this view, so another view and a remount honour it too.
  useQuery({
    queryKey: pendingKey,
    queryFn: () => NONE,
    enabled: false,
    initialData: NONE,
    staleTime: Infinity,
    gcTime: Infinity,
  })

  function setPending(update: (pending: Unacknowledged) => Unacknowledged) {
    queryClient.setQueryData<Unacknowledged>(pendingKey, (pending = NONE) => update(pending))
  }

  /** Sends each unacknowledged invalidation again; an acknowledged one is the server's to mark. */
  async function sendPending() {
    for (const provider of queryClient.getQueryData<Unacknowledged>(pendingKey) ?? NONE) {
      try {
        await client?.refreshModelCatalog?.({ provider, invalidate: true })
        setPending((pending) => pending.filter((item) => item !== provider))
      } catch {
        // Still unacknowledged: the list stays marked, and the next read sends it again.
      }
    }
  }

  /**
   * A read of the list. A provider whose invalidation is still unacknowledged stays marked as
   * from an earlier sign-in until the server marks it so itself or acknowledges the request.
   */
  async function readCatalog() {
    await sendPending()
    const answered = await client!.modelCatalog()
    const pending = (queryClient.getQueryData<Unacknowledged>(pendingKey) ?? NONE).filter(
      (provider) => answered[provider].state !== 'stale_sign_in',
    )
    setPending(() => pending)
    const catalog = pending.reduce(markedStale, answered)

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
   * A confirmed sign-in change: once the server has marked the list as from an earlier sign-in,
   * this view marks it too, before the read it starts, so it never shows the old list as current.
   * A refused request keeps the list marked here, and is sent again with each read, until the
   * server acknowledges it or marks the list itself.
   */
  async function signInChanged(provider: AgentProviderId) {
    try {
      await client?.refreshModelCatalog?.({ provider, invalidate: true })
    } catch {
      setPending((pending) => (pending.includes(provider) ? pending : [...pending, provider]))
    }
    // A read sent before the change may still answer with the old list as current.
    await queryClient.cancelQueries({ queryKey })
    queryClient.setQueryData<CatalogRead>(
      queryKey,
      (read) =>
        read && {
          catalog: markedStale(read.catalog, provider),
          settlingSince: read.settlingSince ?? Date.now(),
        },
    )
    void queryClient.invalidateQueries({ queryKey })
  }

  return {
    /** Each provider's list; one read for another authentication than `authentication` names never warns. */
    viewsFor: (authentication?: CatalogAuthentication) =>
      catalogViews(query.data?.catalog, current, authentication),
    refresh,
    signInChanged,
  }
}

export type ModelCatalogState = ReturnType<typeof useModelCatalog>
