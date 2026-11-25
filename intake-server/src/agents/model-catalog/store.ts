// The `agent_model_catalog` rows: what the worker writes about each read, and what the API reads.
// Every worker write takes its time from the caller, so the schedule runs on a controlled clock.
import type { Pool, PoolClient } from 'pg'
import type { AgentCatalogFailure, AgentCatalogModelDto } from '@invimport/contracts'
import { transaction } from '#/db/database.ts'
import type { CaptureBinding } from '#/capture/model.ts'
import type {
  CatalogAuthentication,
  CatalogProvider,
  CatalogRead,
  CatalogReader,
} from './readers.ts'

export interface CatalogKey {
  provider: CatalogProvider
  authentication: CatalogAuthentication
}

export interface CatalogRow extends CatalogKey {
  models: AgentCatalogModelDto[] | null
  cliVersion: string | null
  source: 'cli' | 'api' | null
  readIn: 'vm' | 'host' | null
  readAt: Date | null
  attemptedAt: Date | null
  failure: AgentCatalogFailure | null
  refreshRequestedAt: Date | null
  readingSince: Date | null
  signInGeneration: string | null
  latestGeneration: string | null
  staleSignIn: boolean
}

/** What a read saw when it started, so a request or invalidation during it isn't lost. */
export interface ReadStart {
  refreshSeq: string
  invalidationSeq: string
}

/** A stored list is read again after this long. */
export const CATALOG_MAX_AGE_MS = 12 * 60 * 60 * 1000
/** A failed attempt is retried after this long. */
export const CATALOG_RETRY_MS = 5 * 60 * 1000

const KEY_SQL = `actor_id=$1 AND target_id=$2 AND target_context_id=$3 AND provider=$4 AND authentication=$5`

function keyParams(scope: CaptureBinding, key: CatalogKey) {
  return [scope.actorId, scope.targetId, scope.targetContextId, key.provider, key.authentication]
}

interface RawRow {
  provider: CatalogProvider
  authentication: CatalogAuthentication
  models: AgentCatalogModelDto[] | null
  cli_version: string | null
  source: 'cli' | 'api' | null
  read_in: 'vm' | 'host' | null
  read_at: Date | null
  attempted_at: Date | null
  failure: AgentCatalogFailure | null
  refresh_requested_at: Date | null
  reading_since: Date | null
  sign_in_generation: string | null
  latest_generation: string | null
  stale_sign_in: boolean
}

function catalogRow(row: RawRow): CatalogRow {
  return {
    provider: row.provider,
    authentication: row.authentication,
    models: row.models,
    cliVersion: row.cli_version,
    source: row.source,
    readIn: row.read_in,
    readAt: row.read_at,
    attemptedAt: row.attempted_at,
    failure: row.failure,
    refreshRequestedAt: row.refresh_requested_at,
    readingSince: row.reading_since,
    signInGeneration: row.sign_in_generation,
    latestGeneration: row.latest_generation,
    staleSignIn: row.stale_sign_in,
  }
}

/** Every row of the scope, for the API and the schedule. */
export async function readCatalogRows(
  connection: Pool | PoolClient,
  scope: CaptureBinding,
): Promise<CatalogRow[]> {
  const result = await connection.query<RawRow>(
    `SELECT provider, authentication, models, cli_version, source, read_in, read_at, attempted_at,
        failure, refresh_requested_at, reading_since, sign_in_generation, latest_generation,
        stale_sign_in
      FROM agent_model_catalog
      WHERE actor_id=$1 AND target_id=$2 AND target_context_id=$3`,
    [scope.actorId, scope.targetId, scope.targetContextId],
  )
  return result.rows.map(catalogRow)
}

/** The API's request: through the one function its role may execute on the table. */
export async function requestCatalogRefresh(
  pool: Pool,
  scope: CaptureBinding,
  key: CatalogKey,
  invalidate: boolean,
): Promise<boolean> {
  const result = await pool.query<{ stale: boolean }>(
    'SELECT request_model_catalog_refresh($1,$2,$3,$4,$5,$6) AS stale',
    [...keyParams(scope, key), invalidate],
  )
  return result.rows[0].stale
}

/**
 * Marks a read as running and returns what it must still match when it publishes. Creates the row
 * for a provider read for the first time.
 */
export async function beginCatalogRead(
  pool: Pool,
  scope: CaptureBinding,
  key: CatalogKey,
  now: Date,
): Promise<ReadStart> {
  const result = await pool.query<{ refresh_seq: string; invalidation_seq: string }>(
    `INSERT INTO agent_model_catalog AS c
        (actor_id,target_id,target_context_id,provider,authentication,reading_since)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (actor_id,target_id,target_context_id,provider,authentication)
        DO UPDATE SET reading_since=$6
      RETURNING c.refresh_seq, c.invalidation_seq`,
    [...keyParams(scope, key), now],
  )
  const row = result.rows[0]
  return { refreshSeq: row.refresh_seq, invalidationSeq: row.invalidation_seq }
}

/**
 * Records the newest sign-in generation seen for a key. A generation other than the last one
 * observed is a sign-in change: it marks the list stale and requests a read, and the result says
 * so. A stored list read under another sign-in is marked stale too.
 */
async function observeGenerationOn(
  connection: Pool | PoolClient,
  scope: CaptureBinding,
  key: CatalogKey,
  generation: string,
  now: Date,
): Promise<boolean> {
  const result = await connection.query<{ changed: boolean }>(
    `WITH prior AS (
        SELECT latest_generation, sign_in_generation FROM agent_model_catalog WHERE ${KEY_SQL}
      ), observed AS (
        SELECT
          coalesce((SELECT latest_generation IS NOT NULL AND latest_generation<>$6 FROM prior), false)
            AS changed,
          coalesce((SELECT sign_in_generation IS NOT NULL AND sign_in_generation<>$6 FROM prior), false)
            AS other_sign_in
      )
      INSERT INTO agent_model_catalog AS c
        (actor_id,target_id,target_context_id,provider,authentication,latest_generation)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (actor_id,target_id,target_context_id,provider,authentication) DO UPDATE SET
        latest_generation=$6,
        stale_sign_in=c.stale_sign_in OR (SELECT changed OR other_sign_in FROM observed),
        refresh_requested_at=CASE WHEN (SELECT changed FROM observed)
          THEN coalesce(c.refresh_requested_at,$7) ELSE c.refresh_requested_at END,
        refresh_seq=c.refresh_seq + CASE WHEN (SELECT changed FROM observed) THEN 1 ELSE 0 END
      RETURNING (SELECT changed FROM observed) AS changed`,
    [...keyParams(scope, key), generation, now],
  )
  return result.rows[0].changed
}

export function observeCatalogGeneration(
  pool: Pool,
  scope: CaptureBinding,
  key: CatalogKey,
  generation: string,
  now: Date,
) {
  return observeGenerationOn(pool, scope, key, generation, now)
}

/**
 * A request made before the read started is answered by it; a later one stays. Its statements
 * pass the read's starting `refresh_seq` as `$6`, after the five key parameters.
 */
const CLEAR_ANSWERED_REQUEST = `refresh_requested_at=CASE WHEN refresh_seq=$6 THEN NULL ELSE refresh_requested_at END`

export interface PublishedRead extends CatalogRead {
  source: CatalogReader['source']
  readIn: CatalogReader['readIn']
}

/**
 * Stores a read's list in one transaction, but only while no invalidation came during the read
 * and, for a fenced reader, the reply's generation equals `current` (taken from the source just
 * before) and the row's latest observed one. Otherwise it records what it saw and discards the
 * reply, so an old sign-in's list never becomes current.
 */
export async function publishCatalogRead(
  pool: Pool,
  scope: CaptureBinding,
  key: CatalogKey,
  read: PublishedRead,
  started: ReadStart,
  current: string | null,
  now: Date,
): Promise<'published' | 'discarded'> {
  return transaction(pool, async (client) => {
    const locked = await client.query<{ invalidation_seq: string }>(
      `SELECT invalidation_seq FROM agent_model_catalog WHERE ${KEY_SQL} FOR UPDATE`,
      keyParams(scope, key),
    )
    if (locked.rows[0]?.invalidation_seq !== started.invalidationSeq) {
      return 'discarded'
    }
    if (current !== null) {
      await observeGenerationOn(client, scope, key, current, now)
      if (read.generation !== current) {
        return 'discarded'
      }
    }
    const stored = await client.query(
      `UPDATE agent_model_catalog SET
          models=$7::jsonb, cli_version=$8, source=$9, read_in=$10, read_at=$11, attempted_at=$11,
          failure=NULL, sign_in_generation=$12, latest_generation=coalesce($12, latest_generation),
          stale_sign_in=false, reading_since=NULL, ${CLEAR_ANSWERED_REQUEST}
        WHERE ${KEY_SQL} AND invalidation_seq=$13
          AND latest_generation IS NOT DISTINCT FROM coalesce($12, latest_generation)`,
      [
        ...keyParams(scope, key),
        started.refreshSeq,
        JSON.stringify(read.models),
        read.cliVersion,
        read.source,
        read.readIn,
        now,
        read.generation,
        started.invalidationSeq,
      ],
    )
    return stored.rowCount === 1 ? 'published' : 'discarded'
  })
}

/** Records a failed attempt; the stored list, its read time and `stale_sign_in` stay. */
export async function recordCatalogFailure(
  pool: Pool,
  scope: CaptureBinding,
  key: CatalogKey,
  failure: AgentCatalogFailure,
  started: ReadStart,
  now: Date,
) {
  await pool.query(
    `UPDATE agent_model_catalog SET attempted_at=$7, failure=$8, reading_since=NULL,
        ${CLEAR_ANSWERED_REQUEST}
      WHERE ${KEY_SQL}`,
    [...keyParams(scope, key), started.refreshSeq, now, failure],
  )
}

/** Clears a request no reader can answer, such as an API key with no route in the guest. */
export async function clearCatalogRequest(pool: Pool, scope: CaptureBinding, key: CatalogKey) {
  await pool.query(
    `UPDATE agent_model_catalog SET refresh_requested_at=NULL, reading_since=NULL WHERE ${KEY_SQL}`,
    keyParams(scope, key),
  )
}

/** A worker that starts holds no read, so a read it never finished no longer reads as running. */
export async function clearStaleReads(pool: Pool, scope: CaptureBinding) {
  await pool.query(
    `UPDATE agent_model_catalog SET reading_since=NULL
      WHERE actor_id=$1 AND target_id=$2 AND target_context_id=$3 AND reading_since IS NOT NULL`,
    [scope.actorId, scope.targetId, scope.targetContextId],
  )
}

/** Whether a key's row asks for a read now: requested, never read, stale with age, or failed. */
export function catalogReadDue(row: CatalogRow | undefined, now: Date) {
  if (!row) {
    return true
  }
  if (row.refreshRequestedAt !== null) {
    return true
  }
  const time = now.getTime()
  const retryPassed =
    row.attemptedAt === null || time - row.attemptedAt.getTime() >= CATALOG_RETRY_MS
  const lastFailed =
    row.failure !== null &&
    row.attemptedAt !== null &&
    (row.readAt === null || row.attemptedAt.getTime() > row.readAt.getTime())
  if (row.readAt === null || lastFailed) {
    return retryPassed
  }
  return time - row.readAt.getTime() >= CATALOG_MAX_AGE_MS
}
