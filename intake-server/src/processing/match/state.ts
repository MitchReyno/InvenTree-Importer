import type { PoolClient } from 'pg'
import { and, desc, eq } from 'drizzle-orm'
import { canonicalRecord, strictJson } from '@invimport/contracts/json'
import {
  validate,
  type MatchIdentityDto,
  type MatchKeyDto,
  type MatchOutcomeDto,
} from '@invimport/contracts'
import { executeDatabaseQuery, queryDatabase } from '#/db/database.ts'
import { sha256 } from '#/db/authority.ts'
import { processingMatches, processingMatchOutcomes, processingMatchSearches } from './schema.ts'

/** Why a search was requested; Check again is the operator's, the rest follow identity changes. */
export type MatchRequestReason = 'examine' | 'operator' | 'check_again' | 'start'

/** A committed search request: the identity and keys searched, sealed with the request. */
export interface MatchRequest {
  schema_version: 'bench-intake-match-request/1'
  batch_id: string
  lot_id: string
  generation: string
  identity: MatchIdentityDto
  keys: MatchKeyDto[]
  reason: MatchRequestReason
}

export type MatchRow = typeof processingMatches.$inferSelect

/**
 * Commits a search request for the lot: the next search generation, the identity it is for and
 * the keys to search with. The search itself runs after commit, in the API process; until it
 * settles, no answer, claim or queueing acts on the lot's earlier result. Caller holds the
 * capture lock and, when queueing follows, the media locks; this takes the lot's Match row.
 */
export async function requestSearch(
  client: PoolClient,
  input: {
    batchId: string
    lotId: string
    identity: MatchIdentityDto
    keys: readonly MatchKeyDto[]
    reason: MatchRequestReason
  },
) {
  const identity = Buffer.from(canonicalRecord(input.identity))
  // A new lot's stages wait for its first search; a known lot keeps its waits and state until
  // the new search settles, since claims and answers already wait for a pending search.
  const rows = await client.query<{ generation: string }>(
    `INSERT INTO public.processing_match
       (lot_id,batch_id,search_generation,state,waits,identity_bytes)
     VALUES ($1,$2,1,'searching',ARRAY['research','images']::text[],$3)
     ON CONFLICT (lot_id) DO UPDATE
       SET search_generation=processing_match.search_generation+1,
           identity_bytes=EXCLUDED.identity_bytes,
           updated_at=now()
     RETURNING search_generation::text AS generation`,
    [input.lotId, input.batchId, identity],
  )
  const generation = rows.rows[0].generation
  const request: MatchRequest = {
    schema_version: 'bench-intake-match-request/1',
    batch_id: input.batchId,
    lot_id: input.lotId,
    generation,
    identity: input.identity,
    keys: [...input.keys],
    reason: input.reason,
  }
  const bytes = Buffer.from(canonicalRecord(request))
  await executeDatabaseQuery(
    queryDatabase(client)
      .insert(processingMatchSearches)
      .values({
        lotId: input.lotId,
        generation: BigInt(generation),
        batchId: input.batchId,
        requestBytes: bytes,
        requestDigest: sha256(bytes),
      }),
  )
  return { generation }
}

/** The lot's Match row, locked for a decision; none for a lot Match hasn't seen. */
export async function lockMatch(client: PoolClient, lotId: string): Promise<MatchRow | undefined> {
  const rows = await executeDatabaseQuery(
    queryDatabase(client)
      .select()
      .from(processingMatches)
      .where(eq(processingMatches.lotId, lotId))
      .for('update'),
  )
  return rows[0]
}

/** The lot's Match row as read, for gates that decide without changing it. */
export async function readMatch(client: PoolClient, lotId: string): Promise<MatchRow | undefined> {
  const rows = await executeDatabaseQuery(
    queryDatabase(client)
      .select()
      .from(processingMatches)
      .where(eq(processingMatches.lotId, lotId)),
  )
  return rows[0]
}

/** Whether a search was requested after the latest one that settled. */
export function searchPending(row: MatchRow) {
  return row.searchGeneration > row.settledGeneration
}

/** A retained request, checked field by field; the bytes it was committed with are the authority. */
export function decodeRequest(bytes: Buffer): MatchRequest {
  const value = strictJson(bytes.toString('utf8')) as Partial<MatchRequest> | null
  const reasons: readonly string[] = ['examine', 'operator', 'check_again', 'start']
  if (
    !value ||
    typeof value !== 'object' ||
    value.schema_version !== 'bench-intake-match-request/1' ||
    typeof value.batch_id !== 'string' ||
    typeof value.lot_id !== 'string' ||
    typeof value.generation !== 'string' ||
    !Array.isArray(value.keys) ||
    typeof value.reason !== 'string' ||
    !reasons.includes(value.reason)
  ) {
    throw new Error('match_request_corrupt')
  }
  validate('MatchIdentity', value.identity)
  for (const key of value.keys) {
    validate('MatchKey', key)
  }
  return value as MatchRequest
}

export function decodeIdentity(row: MatchRow): MatchIdentityDto {
  const value: unknown = strictJson(row.identityBytes.toString('utf8'))
  validate('MatchIdentity', value)
  return value as MatchIdentityDto
}

/** The lot's current outcome, verified against its digest; none before the first or while asking. */
export async function currentOutcome(client: PoolClient, row: MatchRow) {
  if (row.outcomeRevision === 0n) {
    return undefined
  }
  const rows = await executeDatabaseQuery(
    queryDatabase(client)
      .select()
      .from(processingMatchOutcomes)
      .where(
        and(
          eq(processingMatchOutcomes.lotId, row.lotId),
          eq(processingMatchOutcomes.revision, row.outcomeRevision),
        ),
      ),
  )
  // Opening a question advances the revision without an outcome, so a lot with an open question
  // has none until it is answered.
  const latest = rows[0]
  if (!latest) {
    return undefined
  }
  if (!sha256(latest.outcomeBytes).equals(latest.outcomeDigest)) {
    throw new Error('match_outcome_corrupt')
  }
  const value: unknown = strictJson(latest.outcomeBytes.toString('utf8'))
  validate('MatchOutcome', value)
  return {
    outcome: value as MatchOutcomeDto,
    revision: latest.revision,
    generation: latest.generation,
    targetPartPk: latest.targetPartPk,
    covered: latest.coveredBytes.toString('utf8'),
    questionId: latest.questionId,
    recordedAt: latest.recordedAt,
  }
}

/** The lot's latest recorded outcome, in force or not; none before the first. */
export async function latestOutcome(client: PoolClient, lotId: string) {
  const rows = await executeDatabaseQuery(
    queryDatabase(client)
      .select()
      .from(processingMatchOutcomes)
      .where(eq(processingMatchOutcomes.lotId, lotId))
      .orderBy(desc(processingMatchOutcomes.revision))
      .limit(1),
  )
  const latest = rows[0]
  if (!latest) {
    return undefined
  }
  if (!sha256(latest.outcomeBytes).equals(latest.outcomeDigest)) {
    throw new Error('match_outcome_corrupt')
  }
  const value: unknown = strictJson(latest.outcomeBytes.toString('utf8'))
  validate('MatchOutcome', value)
  return value as MatchOutcomeDto
}
