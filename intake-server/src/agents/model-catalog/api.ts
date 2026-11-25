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
import type { CatalogAuthentication, CatalogProvider } from './readers.ts'
import { readCatalogRows, requestCatalogRefresh, type CatalogRow } from './store.ts'

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

function catalogState(row: CatalogRow | undefined): AgentProviderCatalogDto['state'] {
  const reading = row?.refreshRequestedAt != null || row?.readingSince != null
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

/** One provider's answer: the stored list, or the built-in one while none is stored. */
export function providerCatalog(
  provider: CatalogProvider,
  authentication: CatalogAuthentication,
  row: CatalogRow | undefined,
): AgentProviderCatalogDto {
  const stored = row?.models ?? null
  return {
    state: catalogState(row),
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
    const row = rows.find(
      (candidate) => candidate.provider === provider && candidate.authentication === authentication,
    )
    return providerCatalog(provider, authentication, row)
  }

  return { claude: forProvider('claude'), codex: forProvider('codex') }
}

/**
 * Requests a read of the provider's current authentication. `invalidate`, which the sign-in
 * dialogs send once a change is confirmed, marks the stored list stale in the same statement.
 */
export async function refreshModelCatalog(
  pool: Pool,
  config: ProcessingConfig,
  request: AgentModelCatalogRefreshDto,
): Promise<AgentModelCatalogRefreshReceiptDto> {
  const settings = await readAgentSettings(pool, config)
  const authentication = settings.providers[request.provider].authentication
  const stale = await requestCatalogRefresh(
    pool,
    config,
    { provider: request.provider, authentication },
    request.invalidate === true,
  )
  return { provider: request.provider, authentication, stale_sign_in: stale }
}
