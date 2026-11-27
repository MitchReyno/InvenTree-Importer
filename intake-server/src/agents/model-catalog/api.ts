// `GET /api/v1/agents/models` and `POST /api/v1/agents/models/refresh`. The API reads the rows the
// worker wrote and may only request a read; the catalogue never changes a saved setting.
import type { Pool } from 'pg'
import {
  BUILT_IN_MODEL_CATALOG,
  type AgentModelCatalogDto,
  type AgentModelCatalogRefreshDto,
  type AgentModelCatalogRefreshReceiptDto,
  type AgentProviderCatalogDto,
} from '@invimport/contracts'
import type { ProcessingConfig } from '#/processing/attempts.ts'
import { readAgentSettings } from '#/agents/settings.ts'
import { catalogRoute, type CatalogAuthentication, type CatalogProvider } from './readers.ts'
import { readCatalogRows, requestCatalogRefresh, type CatalogRow } from './store.ts'

/**
 * What of a row belongs to the route this profile reads on: the list only when it was read there,
 * the last attempt only when it ran there, and a read in progress only when it runs there. A
 * request is the active route's to answer. Another route's parts are left out, as never read.
 */
function routeView(row: CatalogRow, readIn: 'vm' | 'host'): CatalogRow {
  const ownList = row.readIn === readIn
  const ownAttempt = row.attemptIn === readIn
  const ownRead = row.readingIn === readIn
  return {
    ...row,
    models: ownList ? row.models : null,
    cliVersion: ownList ? row.cliVersion : null,
    source: ownList ? row.source : null,
    readIn: ownList ? row.readIn : null,
    readAt: ownList ? row.readAt : null,
    staleSignIn: ownList && row.staleSignIn,
    attemptedAt: ownAttempt ? row.attemptedAt : null,
    failure: ownAttempt ? row.failure : null,
    readingSince: ownRead ? row.readingSince : null,
  }
}

function iso(time: Date | null) {
  return time === null ? null : time.toISOString()
}

/** Whether the last attempt failed after the stored list was read. */
function lastAttemptFailed(row: CatalogRow) {
  if (row.failure === null || row.attemptedAt === null) {
    return false
  }
  return row.readAt === null || row.attemptedAt.getTime() > row.readAt.getTime()
}

/** Whether the last attempt found the provider lists no models for this sign-in. */
function notListed(row: CatalogRow | undefined) {
  return row !== undefined && lastAttemptFailed(row) && row.failure === 'not_listed'
}

function catalogState(row: CatalogRow | undefined): AgentProviderCatalogDto['state'] {
  const reading = row?.refreshRequestedAt != null || row?.readingSince != null
  // The provider's own answer under the current sign-in, so it stands over any stored list.
  if (notListed(row) && !reading) {
    return 'not_listed'
  }
  if (!row?.models) {
    return reading ? 'reading' : 'never_read'
  }
  // A list from an earlier sign-in stays marked, through a reread and its failure, until a list
  // read under the current one is published.
  if (row.staleSignIn) {
    return 'stale_sign_in'
  }
  if (reading) {
    return 'reading'
  }
  return lastAttemptFailed(row) ? 'failed' : 'current'
}

/**
 * One provider's answer: the stored list, or the built-in one while none is stored or the provider
 * lists none for this sign-in.
 */
export function providerCatalog(
  provider: CatalogProvider,
  authentication: CatalogAuthentication,
  row: CatalogRow | undefined,
): AgentProviderCatalogDto {
  const state = catalogState(row)
  const stored = state === 'not_listed' ? null : (row?.models ?? null)
  return {
    state,
    authentication,
    source: stored ? row!.source : null,
    read_in: stored ? row!.readIn : null,
    cli_version: stored ? row!.cliVersion : null,
    read_at: iso(row?.readAt ?? null),
    attempted_at: iso(row?.attemptedAt ?? null),
    failure: row && lastAttemptFailed(row) ? row.failure : null,
    builtin: stored === null,
    models: stored ?? [...BUILT_IN_MODEL_CATALOG[provider]],
  }
}

/** Each provider's list for its current authentication. */
export async function readModelCatalog(
  pool: Pool,
  config: ProcessingConfig,
): Promise<AgentModelCatalogDto> {
  const [settings, rows] = await Promise.all([
    readAgentSettings(pool, config),
    readCatalogRows(pool, config),
  ])

  const forProvider = (provider: CatalogProvider) => {
    const authentication = settings.providers[provider].authentication
    // Only a list read where this profile reads serves it: a list an earlier profile stored on
    // another route belongs to another sign-in, and a mode with no route keeps the built-in list.
    const route = catalogRoute(config.profileId, authentication)
    const readIn = route === 'guest' ? 'vm' : route
    const row = rows.find(
      (candidate) => candidate.provider === provider && candidate.authentication === authentication,
    )
    if (!readIn || !row) {
      return providerCatalog(provider, authentication, undefined)
    }
    return providerCatalog(provider, authentication, routeView(row, readIn))
  }

  return { claude: forProvider('claude'), codex: forProvider('codex') }
}

/**
 * Requests a read of the provider's list for `authentication`, else its saved authentication.
 * `invalidate`, which the sign-in dialogs send once a change is confirmed, marks the stored list
 * stale in the same statement; a dialog names the sign-in method it changed, which may not be the
 * saved one, so switching back to it later never shows the old sign-in's list as current.
 */
export async function refreshModelCatalog(
  pool: Pool,
  config: ProcessingConfig,
  request: AgentModelCatalogRefreshDto,
): Promise<AgentModelCatalogRefreshReceiptDto> {
  const authentication =
    request.authentication ??
    (await readAgentSettings(pool, config)).providers[request.provider].authentication
  const stale = await requestCatalogRefresh(
    pool,
    config,
    { provider: request.provider, authentication },
    request.invalidate === true,
  )
  return { provider: request.provider, authentication, stale_sign_in: stale }
}
