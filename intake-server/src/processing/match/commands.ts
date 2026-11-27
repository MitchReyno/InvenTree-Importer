import type { Pool, PoolClient } from 'pg'
import { canonicalRecord, strictJson } from '@invimport/contracts/json'
import {
  validate,
  type CaptureSnapshotDto,
  type ExamineIdentityV1Dto,
  type MatchCheckDto,
  type MatchIdentityDto,
  type MatchKeyDto,
} from '@invimport/contracts'
import { transaction } from '#/db/database.ts'
import { appendEvent, idempotent, sha256 } from '#/db/authority.ts'
import { lockCaptureForInputs } from '#/capture/repository.ts'
import type { ProcessingConfig } from '#/processing/attempts.ts'
import { fail } from '#/processing/model.ts'
import { commandScope } from '#/processing/scope.ts'
import { batchInputVersion } from '#/processing/stage-policy.ts'
import { stableIdentityOf } from '#/processing/stable-identity.ts'
import { examineKeys, operatorKeys, operatorLot } from './keys.ts'
import type { MatchResult } from './outcome.ts'
import { matchQuestion } from './questions.ts'
import { openMatchQuestion, standingOf } from './settle.ts'
import {
  currentBinding,
  decodeIdentity,
  decodeRequest,
  lockMatch,
  requestSearch,
  sameBinding,
  searchPending,
  type MatchRow,
} from './state.ts'

/** The keys of an Examine identity proposal, read from its retained bytes. */
async function examineIdentityKeys(client: PoolClient, proposalId: string) {
  const rows = await client.query<{ value_bytes: Buffer }>(
    'SELECT value_bytes FROM public.processing_proposal WHERE id=$1',
    [proposalId],
  )
  const value: unknown = strictJson(rows.rows[0].value_bytes.toString('utf8'))
  validate('ExamineIdentityV1', value)
  return examineKeys(value as ExamineIdentityV1Dto)
}

/** The keys the lot's latest request searched with. */
async function requestedKeys(client: PoolClient, row: MatchRow) {
  const latest = await client.query<{ request_bytes: Buffer }>(
    `SELECT request_bytes FROM public.processing_match_search WHERE lot_id=$1 AND generation=$2`,
    [row.lotId, row.searchGeneration.toString()],
  )
  return latest.rows[0] ? decodeRequest(latest.rows[0].request_bytes).keys : []
}

/**
 * The operator's identifiers for their lot now. A lot a decision bound to an existing Part keeps
 * the keys it was searched with: its target changed, not what it is.
 */
async function operatorKeysNow(
  client: PoolClient,
  snapshot: CaptureSnapshotDto,
  lot: CaptureSnapshotDto['lots'][number],
  row: MatchRow | undefined,
) {
  const part = snapshot.parts.find((candidate) => candidate.id === lot.part_subject_id)
  if (row && part?.choice.mode === 'set') {
    return requestedKeys(client, row)
  }
  return operatorKeys(snapshot, lot)
}

/** The operator identity's next revision: the same while its keys stay the same. */
async function operatorIdentity(
  client: PoolClient,
  row: MatchRow | undefined,
  keys: readonly MatchKeyDto[],
): Promise<{ identity: MatchIdentityDto; changed: boolean }> {
  if (!row) {
    return { identity: { kind: 'operator', revision: '1' }, changed: true }
  }
  const identity = decodeIdentity(row)
  const before = await requestedKeys(client, row)
  const same = canonicalRecord(before) === canonicalRecord(keys)
  if (identity.kind === 'operator' && same) {
    return { identity, changed: false }
  }
  const revision = identity.kind === 'operator' ? (BigInt(identity.revision) + 1n).toString() : '1'
  return { identity: { kind: 'operator', revision }, changed: true }
}

/**
 * What Match searches a lot with now: Examine's stable identity, or, for a lot the operator added
 * without evidence, the identifiers they confirmed. None for a lot Examine hasn't identified.
 */
async function identityNow(
  client: PoolClient,
  snapshot: CaptureSnapshotDto,
  lotId: string,
  row: MatchRow | undefined,
) {
  const lot = snapshot.lots.find(
    (candidate) => candidate.id === lotId && candidate.retired !== true,
  )
  if (!lot) {
    return undefined
  }
  if (operatorLot(lot)) {
    const keys = await operatorKeysNow(client, snapshot, lot, row)
    return { ...(await operatorIdentity(client, row, keys)), keys }
  }
  const [stable] = await stableIdentityOf(client, snapshot.id, lotId)
  if (!stable) {
    return undefined
  }
  const identity: MatchIdentityDto = { kind: 'examine', proposal_id: stable }
  return { identity, keys: await examineIdentityKeys(client, stable), changed: true }
}

/** Check InvenTree again: a new search for each lot, from its current identity. */
export async function checkMatches(
  pool: Pool,
  config: ProcessingConfig,
  batchId: string,
  key: string,
  body: MatchCheckDto,
) {
  validate('MatchCheck', body)
  return transaction(pool, (client) =>
    idempotent(client, commandScope(config, 'match_check', batchId, key), body, async () => {
      const capture = await lockCaptureForInputs(client, config, batchId)
      if ((await batchInputVersion(client, config, batchId)) !== 'bench-intake-input/7') {
        fail('unsupported_processing_profile', 422)
      }
      const lots: { lot_id: string; generation: string }[] = []
      for (const lotId of [...body.lot_ids].sort()) {
        const row = await lockMatch(client, lotId)
        const now = await identityNow(client, capture.snapshot, lotId, row)
        if (!now) {
          fail('match_not_searchable', 409)
        }
        const requested = await requestSearch(client, {
          batchId,
          lotId,
          identity: now.identity,
          keys: now.keys,
          reason: 'check_again',
        })
        lots.push({ lot_id: lotId, generation: requested.generation })
      }
      await appendEvent(client, capture.streamId, 'processing_changed', { batch_id: batchId })
      return { batch_id: batchId, lots }
    }),
  )
}

/** The latest settled search's findings, for a question asked again from them. */
async function settledResult(client: PoolClient, row: MatchRow) {
  const rows = await client.query<{ result_bytes: Buffer | null; result_digest: Buffer | null }>(
    'SELECT result_bytes,result_digest FROM public.processing_match_search WHERE lot_id=$1 AND generation=$2',
    [row.lotId, row.settledGeneration.toString()],
  )
  const found = rows.rows[0]
  if (
    !found?.result_bytes ||
    !found.result_digest ||
    !sha256(found.result_bytes).equals(found.result_digest)
  ) {
    return undefined
  }
  return strictJson(found.result_bytes.toString('utf8')) as MatchResult
}

/**
 * Decide again: asks the lot's question afresh from its latest settled search, so the operator
 * can change a decision. Its stages wait for the answer, as for any match question.
 */
export async function reopenMatch(
  pool: Pool,
  config: ProcessingConfig,
  batchId: string,
  lotId: string,
  key: string,
) {
  return transaction(pool, (client) =>
    idempotent(
      client,
      commandScope(config, 'match_reopen', batchId, key),
      { lot_id: lotId },
      async () => {
        const capture = await lockCaptureForInputs(client, config, batchId)
        const row = (await lockMatch(client, lotId)) ?? fail('not_found', 404)
        if (row.batchId !== batchId) {
          fail('not_found', 404)
        }
        if (searchPending(row) || row.state === 'question') {
          fail('match_waiting', 409)
        }
        const result = await settledResult(client, row)
        if (!result || result.searched === 'unavailable') {
          return fail('match_waiting', 409)
        }
        const standing = await standingOf(client, row)
        const basis = standing.outcome?.outcome.basis
        const kind = result.contribution
          ? 'contribution'
          : result.candidates.length
            ? 'candidates'
            : basis?.kind === 'decision' &&
                (basis.decision === 'add_stock' || basis.decision === 'fill_gaps')
              ? 'target_lost'
              : 'unresolved'
        const label = capture.snapshot.lots.find((lot) => lot.id === lotId)?.label ?? 'this lot'
        const question = matchQuestion(kind, label, result)
        const opened = await openMatchQuestion(client, row, question, row.settledGeneration)
        await client.query(
          `UPDATE public.processing_match SET state='question', waits=ARRAY['research','images']::text[],
           outcome_revision=$2, question_id=$3, updated_at=now() WHERE lot_id=$1`,
          [lotId, opened.revision.toString(), opened.id],
        )
        await appendEvent(client, capture.streamId, 'processing_changed', { batch_id: batchId })
        return {
          batch_id: batchId,
          lots: [{ lot_id: lotId, generation: row.searchGeneration.toString() }],
        }
      },
    ),
  )
}

/** How many lots one sweep looks at whose Capture binding has moved on from Match's. */
export const MATCH_DRIFT_LIMIT = 50

/**
 * Requests a search for each lot of this actor, target and context whose Capture binding is no
 * longer the one Match last searched or decided for, whatever path changed it: a relink, a draft's
 * identifiers, a Review move. Its stages wait at the gate until that search settles. Returns the
 * lots searched.
 */
export async function requestDriftedSearches(
  pool: Pool,
  config: ProcessingConfig,
  limit = MATCH_DRIFT_LIMIT,
) {
  const drifted = await pool.query<{ lot_id: string; batch_id: string }>(
    `SELECT m.lot_id, m.batch_id FROM public.processing_match m
     JOIN public.capture_batch b ON b.id=m.batch_id
     WHERE b.actor_id=$1 AND b.target_id=$2 AND b.target_context_id=$3 AND NOT b.archived
       AND m.search_generation=m.settled_generation
       AND NOT EXISTS (SELECT 1 FROM public.capture_lot_retirement r WHERE r.lot_id=m.lot_id)
       AND public.processing_match_binding(m.lot_id) IS DISTINCT FROM m.binding
     ORDER BY m.updated_at, m.lot_id
     LIMIT $4`,
    [config.actorId, config.targetId, config.targetContextId, limit],
  )
  const byBatch = new Map<string, string[]>()
  for (const row of drifted.rows) {
    byBatch.set(row.batch_id, [...(byBatch.get(row.batch_id) ?? []), row.lot_id])
  }
  const searched: string[] = []
  for (const [batchId, lotIds] of [...byBatch].sort(([a], [b]) => a.localeCompare(b))) {
    await transaction(pool, async (client) => {
      const capture = await lockCaptureForInputs(client, config, batchId)
      let requested = 0
      for (const lotId of [...lotIds].sort()) {
        const row = await lockMatch(client, lotId)
        if (
          !row ||
          searchPending(row) ||
          sameBinding(await currentBinding(client, lotId), row.binding)
        ) {
          continue
        }
        const now = await identityNow(client, capture.snapshot, lotId, row)
        if (!now) {
          // Nothing to search with yet (Examine's next identity, say): it waits behind the rest.
          await client.query(
            'UPDATE public.processing_match SET updated_at=now() WHERE lot_id=$1',
            [lotId],
          )
          continue
        }
        await requestSearch(client, {
          batchId,
          lotId,
          identity: now.identity,
          keys: now.keys,
          reason: 'operator',
        })
        searched.push(lotId)
        requested += 1
      }
      if (requested) {
        await appendEvent(client, capture.streamId, 'processing_changed', { batch_id: batchId })
      }
    })
  }
  return searched
}

/** Whether this role can read Match: a deployment whose capture role can't has no Processing. */
async function readsMatch(client: PoolClient) {
  const privilege = await client.query<{ match: boolean }>(
    "SELECT has_table_privilege('processing_match', 'SELECT') AS match",
  )
  return privilege.rows[0]?.match === true
}

/**
 * After an operator's Capture edit: a lot they added without evidence enters Match from the
 * identifiers they confirmed, as a revisioned operator identity, whenever those change, and any
 * lot bound to another Part than its outcome set is searched again, to be decided afresh. Runs in
 * the edit's transaction, before it publishes, for batches whose pipeline is `/7`'s.
 */
export function matchCaptureHooks(config: ProcessingConfig) {
  return {
    async afterEdit(client: PoolClient, after: CaptureSnapshotDto) {
      if (!(await readsMatch(client))) {
        return
      }
      if ((await batchInputVersion(client, config, after.id)) !== 'bench-intake-input/7') {
        return
      }
      for (const lot of after.lots.filter(operatorLot)) {
        const row = await lockMatch(client, lot.id)
        const keys = await operatorKeysNow(client, after, lot, row)
        if (!row && !keys.length) {
          continue
        }
        const next = await operatorIdentity(client, row, keys)
        if (!next.changed) {
          continue
        }
        await requestSearch(client, {
          batchId: after.id,
          lotId: lot.id,
          identity: next.identity,
          keys,
          reason: 'operator',
        })
      }
    },
  }
}
