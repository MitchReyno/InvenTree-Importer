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

/**
 * A provider's sign-in changes and the invalidations that cover them. Changes are numbered as
 * they are made; an invalidation the server acknowledges covers every change made before it was
 * sent, since the server marks the list then. The list stays marked here while a change is newer
 * than every covered one; a refusal covers nothing and adds nothing.
 */
type Changes = { latest: number; covered: number; authentication: Authentication }

type SignInChanges = Partial<Record<AgentProviderId, Changes>>

const NONE: SignInChanges = {}

const PROVIDERS = ['claude', 'codex'] as const satisfies readonly AgentProviderId[]

/** Numbers sign-in changes across every view of the catalogue in this tab. */
let changeCount = 0

/** Whether a provider's list must stay marked: a change no acknowledged invalidation covers. */
function uncovered(changes: Changes | undefined): changes is Changes {
  return changes !== undefined && changes.latest > changes.covered
}

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
  const changesKey = serverQueryKey(scope, 'model-catalog', 'sign-in-changes')
  // Kept beside the read rather than in this view, so another view and a remount honour it too.
  useQuery({
    queryKey: changesKey,
    queryFn: () => NONE,
    enabled: false,
    initialData: NONE,
    staleTime: Infinity,
    gcTime: Infinity,
  })

  function changesNow() {
    return queryClient.getQueryData<SignInChanges>(changesKey) ?? NONE
  }

  function updateChanges(
    provider: AgentProviderId,
    authentication: Authentication,
    update: (changes: Changes) => Changes,
  ) {
    queryClient.setQueryData<SignInChanges>(changesKey, (all = NONE) => {
      const known = all[provider] ?? { latest: 0, covered: 0, authentication }
      return { ...all, [provider]: update(known) }
    })
  }

  /**
   * Sends an invalidation covering every change made so far. An acknowledgement covers them; a
   * refusal leaves them for the next attempt.
   */
  async function invalidate(provider: AgentProviderId, authentication: Authentication) {
    const covers = changesNow()[provider]?.latest ?? 0
    try {
      await client!.refreshModelCatalog!({ provider, authentication, invalidate: true })
    } catch {
      return
    }
    updateChanges(provider, authentication, (changes) => ({
      ...changes,
      covered: Math.max(changes.covered, covers),
    }))
  }

  /**
   * Sends an invalidation again for each provider whose list is still marked here, unless the
   * read was cancelled meanwhile. A view that can't send one leaves it for one that can.
   */
  async function sendPending(signal: AbortSignal) {
    if (!client?.refreshModelCatalog) {
      return
    }
    for (const provider of PROVIDERS) {
      const waiting = changesNow()[provider]
      if (signal.aborted) {
        return
      }
      if (uncovered(waiting)) {
        await invalidate(provider, waiting.authentication)
      }
    }
  }

  /**
   * A read of the list. A provider with a change no acknowledged invalidation covers stays marked
   * as from an earlier sign-in, as does one that had such a change when this read was sent, since
   * the answer may predate the server's mark. A cancelled read sends nothing more and is unused.
   */
  async function readCatalog({ signal }: { signal: AbortSignal }) {
    await sendPending(signal)
    if (signal.aborted) {
      throw new Error('model_catalog_read_cancelled')
    }
    const sentWith = changesNow()
    const answered = await client!.modelCatalog()
    if (signal.aborted) {
      throw new Error('model_catalog_read_cancelled')
    }
    let catalog = answered
    for (const provider of PROVIDERS) {
      const waiting = changesNow()[provider]
      const waited = sentWith[provider]
      if (uncovered(waiting)) {
        catalog = markedStale(catalog, provider, waiting.authentication)
      } else if (uncovered(waited)) {
        catalog = markedStale(catalog, provider, waited.authentication)
      }
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
   * A sign-in change the VM confirmed, or may have made, for the provider's `authentication`.
   * It is numbered and its invalidation sent; whatever the answer, this view marks that list as
   * from an earlier sign-in before the read it starts, so it never shows the old list as current.
   * Until an acknowledged invalidation sent after it covers it, the list stays marked and one is
   * sent again before each read.
   */
  async function signInChanged(provider: AgentProviderId, authentication: Authentication) {
    changeCount += 1
    const change = changeCount
    updateChanges(provider, authentication, (changes) => ({
      ...changes,
      latest: Math.max(changes.latest, change),
      authentication,
    }))
    if (client?.refreshModelCatalog) {
      await invalidate(provider, authentication)
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
