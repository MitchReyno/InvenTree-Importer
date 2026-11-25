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
 * A provider's invalidation attempts, numbered as they are sent. The server marks the list when
 * it acknowledges one, after every sign-in change made before it was sent; so the list must stay
 * marked here while a refused attempt is newer than every acknowledged one.
 */
type Attempts = { acknowledged: number; refused: number; authentication: Authentication }

type InvalidationAttempts = Partial<Record<AgentProviderId, Attempts>>

const NONE: InvalidationAttempts = {}

const PROVIDERS = ['claude', 'codex'] as const satisfies readonly AgentProviderId[]

/** Numbers invalidation attempts across every view of the catalogue in this tab. */
let attemptCount = 0

/** Whether a provider's list must stay marked: a refused attempt no acknowledgement covers. */
function unacknowledged(attempts: Attempts | undefined): attempts is Attempts {
  return attempts !== undefined && attempts.refused > attempts.acknowledged
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
  const attemptsKey = serverQueryKey(scope, 'model-catalog', 'invalidations')
  // Kept beside the read rather than in this view, so another view and a remount honour it too.
  useQuery({
    queryKey: attemptsKey,
    queryFn: () => NONE,
    enabled: false,
    initialData: NONE,
    staleTime: Infinity,
    gcTime: Infinity,
  })

  function attemptsNow() {
    return queryClient.getQueryData<InvalidationAttempts>(attemptsKey) ?? NONE
  }

  /** Records an attempt's outcome; a newer outcome of either kind is never replaced. */
  function record(
    provider: AgentProviderId,
    authentication: Authentication,
    outcome: { acknowledged: number } | { refused: number },
  ) {
    queryClient.setQueryData<InvalidationAttempts>(attemptsKey, (all = NONE) => {
      const known = all[provider] ?? { acknowledged: 0, refused: 0, authentication }
      const next =
        'acknowledged' in outcome
          ? { ...known, acknowledged: Math.max(known.acknowledged, outcome.acknowledged) }
          : { ...known, refused: Math.max(known.refused, outcome.refused), authentication }
      return { ...all, [provider]: next }
    })
  }

  /** Sends one invalidation attempt and records how it went. */
  async function attempt(provider: AgentProviderId, authentication: Authentication) {
    attemptCount += 1
    const sent = attemptCount
    try {
      await client!.refreshModelCatalog!({ provider, authentication, invalidate: true })
      record(provider, authentication, { acknowledged: sent })
    } catch {
      record(provider, authentication, { refused: sent })
    }
  }

  /**
   * Sends an invalidation again for each provider whose list is still marked here. A view that
   * can't send one leaves it for one that can.
   */
  async function sendPending() {
    if (!client?.refreshModelCatalog) {
      return
    }
    for (const provider of PROVIDERS) {
      const waiting = attemptsNow()[provider]
      if (unacknowledged(waiting)) {
        await attempt(provider, waiting.authentication)
      }
    }
  }

  /**
   * A read of the list. A provider with a refused attempt no acknowledgement covers stays marked
   * as from an earlier sign-in, as does one that had such an attempt when this read was sent,
   * since the answer may predate the server's mark. A read sent after a refused attempt that
   * finds the server has marked the list itself covers that attempt. A cancelled read is unused.
   */
  async function readCatalog({ signal }: { signal: AbortSignal }) {
    await sendPending()
    const sentWith = attemptsNow()
    const answered = await client!.modelCatalog()
    if (signal.aborted) {
      throw new Error('model_catalog_read_cancelled')
    }
    for (const provider of PROVIDERS) {
      const waiting = sentWith[provider]
      const listed = answered[provider]
      const markedByServer =
        unacknowledged(waiting) &&
        listed.authentication === waiting.authentication &&
        listed.state === 'stale_sign_in'
      if (markedByServer) {
        record(provider, waiting.authentication, { acknowledged: waiting.refused })
      }
    }
    let catalog = answered
    for (const provider of PROVIDERS) {
      const waiting = attemptsNow()[provider]
      const waited = sentWith[provider]
      if (unacknowledged(waiting)) {
        catalog = markedStale(catalog, provider, waiting.authentication)
      } else if (unacknowledged(waited) && answered[provider].state !== 'stale_sign_in') {
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
   * Its invalidation is sent, and whatever the answer this view marks that list as from an
   * earlier sign-in before the read it starts, so it never shows the old list as current. A
   * refused attempt keeps the list marked, and is sent again before each read, until a newer
   * attempt is acknowledged or a read finds the server has marked the list itself.
   */
  async function signInChanged(provider: AgentProviderId, authentication: Authentication) {
    if (client?.refreshModelCatalog) {
      await attempt(provider, authentication)
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
