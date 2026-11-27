import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { and, eq, isNull } from 'drizzle-orm'
import { canonicalRecord } from '@invimport/contracts/json'
import type { CaptureSnapshotDto, MatchOutcomeDto } from '@invimport/contracts'
import { executeDatabaseQuery, queryDatabase, transaction } from '#/db/database.ts'
import { appendEvent, sha256 } from '#/db/authority.ts'
import { captureInTransaction, lockCaptureForInputs } from '#/capture/repository.ts'
import { prepareMediaTransaction } from '#/media/transaction.ts'
import type { LockedMediaInputs } from '#/media/locked-inputs.ts'
import type { ProcessingConfig } from '../attempts.ts'
import { notifyRevision } from '../currentness.ts'
import { reserveProcessingMedia, reservedMediaFor } from '../media.ts'
import { ProcessingError } from '../model.ts'
import { configuredInputVersion } from '../stage-policy.ts'
import {
  coveredOf,
  nextStep,
  outcomeRecord,
  type MatchResult,
  type MatchStanding,
} from './outcome.ts'
import { matchQuestion } from './questions.ts'
import { queueOutcomeStages, stageSettings } from './queue.ts'
import {
  processingMatches,
  processingMatchOutcomes,
  processingMatchQuestions,
  processingMatchSearches,
} from './schema.ts'
import {
  currentOutcome,
  decodeIdentity,
  latestOutcome,
  decodeRequest,
  lockMatch,
  type MatchRequest,
  type MatchRow,
} from './state.ts'
import { decodeQuestionContent, type StoredQuestion } from './stored-question.ts'

/** Runs a request's reads, outside any transaction. */
export type MatchSearch = (request: MatchRequest) => Promise<MatchResult>

const LOT_STAGES = ['research', 'images'] as const

/** The open question on a lot, as its content was stored. */
async function openQuestion(client: PoolClient, row: MatchRow) {
  if (!row.questionId) {
    return undefined
  }
  const rows = await executeDatabaseQuery(
    queryDatabase(client)
      .select()
      .from(processingMatchQuestions)
      .where(
        and(
          eq(processingMatchQuestions.id, row.questionId),
          eq(processingMatchQuestions.state, 'open'),
        ),
      ),
  )
  return rows[0]
}

/** What the lot had when its search settled: its outcome, any open question and its identity. */
export async function standingOf(client: PoolClient, row: MatchRow): Promise<MatchStanding> {
  const outcome = await currentOutcome(client, row)
  const recorded = await latestOutcome(client, row.lotId)
  const question = await openQuestion(client, row)
  const content = question ? decodeQuestionContent(question) : undefined
  const outcomeIdentity = outcome
    ? await requestIdentity(client, row.lotId, outcome.generation)
    : undefined
  return {
    identity: decodeIdentity(row),
    ...(outcome
      ? {
          outcome: {
            outcome: outcome.outcome,
            covered: outcome.covered,
            targetPartPk: outcome.targetPartPk,
          },
        }
      : {}),
    ...(recorded ? { recorded: { outcome: recorded } } : {}),
    ...(outcomeIdentity ? { outcomeIdentity } : {}),
    ...(question && content
      ? { openQuestion: { kind: question.kind, covered: coveredOf(content) } }
      : {}),
  }
}

/** The identity a request of the lot searched for. */
async function requestIdentity(client: PoolClient, lotId: string, generation: bigint) {
  const rows = await client.query<{ request_bytes: Buffer }>(
    'SELECT request_bytes FROM public.processing_match_search WHERE lot_id=$1 AND generation=$2',
    [lotId, generation.toString()],
  )
  return rows.rows[0] ? decodeRequest(rows.rows[0].request_bytes).identity : undefined
}

/** Closes the lot's open question, if any: answered, or superseded by a newer one. */
export async function closeQuestion(
  client: PoolClient,
  row: MatchRow,
  state: 'answered' | 'superseded',
) {
  if (!row.questionId) {
    return
  }
  await client.query(
    `UPDATE public.processing_match_question SET state=$2, closed_at=now()
     WHERE id=$1 AND state='open'`,
    [row.questionId, state],
  )
}

/** Opens a question on the lot, advancing its outcome revision. Returns the new revision. */
export async function openMatchQuestion(
  client: PoolClient,
  row: MatchRow,
  question: StoredQuestion,
  generation: bigint,
) {
  await closeQuestion(client, row, 'superseded')
  const revision = row.outcomeRevision + 1n
  const id = randomUUID()
  const bytes = Buffer.from(canonicalRecord(question))
  await executeDatabaseQuery(
    queryDatabase(client)
      .insert(processingMatchQuestions)
      .values({
        id,
        lotId: row.lotId,
        batchId: row.batchId,
        generation,
        outcomeRevision: revision,
        kind: question.kind,
        questionBytes: bytes,
        questionDigest: sha256(bytes),
        state: 'open',
      }),
  )
  return { id, revision }
}

/** Records a new outcome at the next revision. */
export async function recordOutcome(
  client: PoolClient,
  row: MatchRow,
  input: {
    basis: MatchOutcomeDto['basis']
    modes: Pick<MatchOutcomeDto, 'research' | 'images'>
    covered: string
    generation: bigint
    targetPartPk?: string
    questionId?: string
  },
) {
  const revision = row.outcomeRevision + 1n
  const outcome = outcomeRecord(row.lotId, revision, input.basis, input.modes)
  const bytes = Buffer.from(canonicalRecord(outcome))
  await executeDatabaseQuery(
    queryDatabase(client)
      .insert(processingMatchOutcomes)
      .values({
        lotId: row.lotId,
        revision,
        generation: input.generation,
        outcomeBytes: bytes,
        outcomeDigest: sha256(bytes),
        targetPartPk: input.targetPartPk ?? null,
        coveredBytes: Buffer.from(input.covered),
        questionId: input.questionId ?? null,
      }),
  )
  return outcome
}

/**
 * Tells the lot's stage sessions that its Match outcome moved on, when they exist; a stage that
 * hasn't started reads the outcome from its own input, and a first outcome replaces none.
 */
export async function tellOutcome(
  client: PoolClient,
  batchId: string,
  lotId: string,
  from: bigint,
  to: bigint,
  briefRevision: string,
) {
  // A lot's first outcome changes nothing a session was sealed with.
  if (from === 0n) {
    return
  }
  const lineages = await client.query<{ id: string }>(
    `SELECT id FROM public.processing_job
     WHERE batch_id=$1 AND subject_id=$2 AND stage IN ('research','images') ORDER BY id`,
    [batchId, lotId],
  )
  for (const lineage of lineages.rows) {
    await notifyRevision(
      client,
      lineage.id,
      `match:${lotId}:${to}`,
      {
        fields: ['identity'],
        reason: "Match changed the lot's outcome; its stages run in the mode the new outcome sets.",
        changes: [
          {
            kind: 'match',
            lot_id: lotId,
            from: from.toString(),
            to: to.toString(),
          },
        ],
      },
      { origin: { by: 'match' }, briefRevision },
    )
  }
}

/**
 * Queues the outcome's stages when the configuration can seal `/7` and the lot is live, inside a
 * savepoint: media not ready, capacity or settings refusals leave the outcome recorded and the
 * stages unqueued, for Start to queue later.
 */
export async function queueWithinSavepoint(
  client: PoolClient,
  config: ProcessingConfig,
  snapshot: CaptureSnapshotDto,
  lotId: string,
  outcome: MatchOutcomeDto,
  row: MatchRow,
  media: LockedMediaInputs | undefined,
) {
  const lot = snapshot.lots.find((candidate) => candidate.id === lotId)
  if (
    !media ||
    !lot ||
    lot.retired === true ||
    snapshot.archived ||
    configuredInputVersion(config) !== 'bench-intake-input/7'
  ) {
    return []
  }
  await client.query('SAVEPOINT match_queue')
  try {
    const settings = await stageSettings(client, config)
    const queued = await queueOutcomeStages(
      client,
      config,
      snapshot,
      lotId,
      outcome,
      decodeIdentity(row),
      media,
      settings,
    )
    await client.query('RELEASE SAVEPOINT match_queue')
    return queued
  } catch (error) {
    if (!(error instanceof ProcessingError)) {
      throw error
    }
    await client.query('ROLLBACK TO SAVEPOINT match_queue')
    return []
  }
}

/** Reserves the lot's media for queueing, or none when it can't be reserved now. */
export async function lotMedia(
  client: PoolClient,
  config: ProcessingConfig,
  snapshot: CaptureSnapshotDto,
  lotId: string,
) {
  await prepareMediaTransaction(client)
  await client.query('SAVEPOINT match_media')
  try {
    const media = reservedMediaFor(
      await reserveProcessingMedia(client, config, snapshot, [lotId]),
      lotId,
    )
    await client.query('RELEASE SAVEPOINT match_media')
    return media
  } catch (error) {
    if (!(error instanceof ProcessingError)) {
      throw error
    }
    await client.query('ROLLBACK TO SAVEPOINT match_media')
    return undefined
  }
}

async function recordSettlement(
  client: PoolClient,
  request: MatchRequest,
  settlement: 'settled' | 'unavailable' | 'discarded',
  result?: MatchResult,
) {
  const bytes = result ? Buffer.from(canonicalRecord(result)) : null
  await executeDatabaseQuery(
    queryDatabase(client)
      .update(processingMatchSearches)
      .set({
        settlement,
        resultBytes: bytes,
        resultDigest: bytes ? sha256(bytes) : null,
        settledAt: new Date(),
      })
      .where(
        and(
          eq(processingMatchSearches.lotId, request.lot_id),
          eq(processingMatchSearches.generation, BigInt(request.generation)),
          // A generation settles once; a duplicate sweep's later result never replaces it.
          isNull(processingMatchSearches.settlement),
        ),
      ),
  )
}

async function updateRow(
  client: PoolClient,
  lotId: string,
  values: Partial<
    Pick<MatchRow, 'settledGeneration' | 'outcomeRevision' | 'state' | 'waits' | 'questionId'>
  >,
) {
  await executeDatabaseQuery(
    queryDatabase(client)
      .update(processingMatches)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(processingMatches.lotId, lotId)),
  )
}

/**
 * Settles one search: only while it is still the lot's latest request. Under the capture, media
 * and Match locks it records the verdict, opens or keeps the lot's question or outcome, queues
 * the stages the outcome runs and publishes, together. An older result is discarded.
 */
export async function settleInTransaction(
  client: PoolClient,
  config: ProcessingConfig,
  request: MatchRequest,
  result: MatchResult,
) {
  const peek = await captureInTransaction(client, config, request.batch_id, true)
  const capture = peek.snapshot.archived
    ? peek
    : await lockCaptureForInputs(client, config, request.batch_id)
  const snapshot = capture.snapshot
  const live = snapshot.lots.some((lot) => lot.id === request.lot_id && lot.retired !== true)
  const media =
    live && !snapshot.archived
      ? await lotMedia(client, config, snapshot, request.lot_id)
      : undefined
  const row = await lockMatch(client, request.lot_id)
  const generation = BigInt(request.generation)
  if (!row || row.searchGeneration !== generation || row.settledGeneration >= generation) {
    await recordSettlement(client, request, 'discarded', result)
    return 'discarded' as const
  }
  const standing = await standingOf(client, row)
  const step = nextStep(result, standing)
  const lotLabel = snapshot.lots.find((lot) => lot.id === request.lot_id)?.label ?? 'this lot'
  const covered = coveredOf(result)
  let outcomeRevision = row.outcomeRevision
  switch (step.kind) {
    case 'unavailable': {
      await updateRow(client, row.lotId, {
        settledGeneration: generation,
        state: 'unavailable',
        waits: [...LOT_STAGES],
      })
      await recordSettlement(client, request, 'unavailable', result)
      break
    }
    case 'keep_question': {
      await updateRow(client, row.lotId, {
        settledGeneration: generation,
        state: 'question',
        waits: [...LOT_STAGES],
      })
      await recordSettlement(client, request, 'settled', result)
      break
    }
    case 'question': {
      const question = matchQuestion(step.questionKind, lotLabel, result)
      const opened = await openMatchQuestion(client, row, question, generation)
      outcomeRevision = opened.revision
      await updateRow(client, row.lotId, {
        settledGeneration: generation,
        outcomeRevision,
        state: 'question',
        waits: [...LOT_STAGES],
        questionId: opened.id,
      })
      await recordSettlement(client, request, 'settled', result)
      break
    }
    case 'keep': {
      const kept = (await currentOutcome(client, row))!
      await updateRow(client, row.lotId, {
        settledGeneration: generation,
        state: kept.outcome.basis.kind === 'clear' ? 'clear' : 'decided',
        waits: [],
      })
      await recordSettlement(client, request, 'settled', result)
      await queueWithinSavepoint(client, config, snapshot, row.lotId, kept.outcome, row, media)
      break
    }
    case 'clear': {
      const outcome = await recordOutcome(client, row, {
        basis: { kind: 'clear' },
        modes: {
          research: { stage: 'research', mode: 'full' },
          images: { stage: 'images', mode: 'full' },
        },
        covered,
        generation,
      })
      outcomeRevision = BigInt(outcome.revision)
      await closeQuestion(client, row, 'superseded')
      await updateRow(client, row.lotId, {
        settledGeneration: generation,
        outcomeRevision,
        state: 'clear',
        waits: [],
        questionId: null,
      })
      await recordSettlement(client, request, 'settled', result)
      await queueWithinSavepoint(
        client,
        config,
        snapshot,
        row.lotId,
        outcome,
        { ...row, outcomeRevision },
        media,
      )
      break
    }
  }
  if (outcomeRevision !== row.outcomeRevision) {
    await tellOutcome(
      client,
      row.batchId,
      row.lotId,
      row.outcomeRevision,
      outcomeRevision,
      snapshot.revision,
    )
  }
  await appendEvent(client, capture.streamId, 'processing_changed', { batch_id: row.batchId })
  return step.kind
}

/** The pending requests of this actor, target and context, oldest first. */
async function pendingRequests(pool: Pool, config: ProcessingConfig, limit: number) {
  const rows = await pool.query<{ request_bytes: Buffer; request_digest: Buffer }>(
    `SELECT s.request_bytes, s.request_digest FROM public.processing_match_search s
     JOIN public.capture_batch b ON b.id=s.batch_id
     WHERE s.settlement IS NULL AND b.actor_id=$1 AND b.target_id=$2 AND b.target_context_id=$3
     ORDER BY s.requested_at, s.lot_id, s.generation
     LIMIT $4`,
    [config.actorId, config.targetId, config.targetContextId, limit],
  )
  return rows.rows.map((row) => {
    if (!sha256(row.request_bytes).equals(row.request_digest)) {
      throw new Error('match_request_corrupt')
    }
    return decodeRequest(row.request_bytes)
  })
}

/** Discards a request a newer one has replaced, without reading anything for it. */
async function discardIfReplaced(pool: Pool, request: MatchRequest) {
  return transaction(pool, async (client) => {
    const row = await lockMatch(client, request.lot_id)
    if (row && row.searchGeneration === BigInt(request.generation)) {
      return false
    }
    await recordSettlement(client, request, 'discarded')
    return true
  })
}

/** At most this many requests settle per sweep, so one sweep stays bounded. */
export const MATCH_SWEEP_LIMIT = 10

/**
 * Settles the committed, unsettled search requests: each request's reads run outside any
 * transaction, then it settles only if it is still its lot's latest. A request committed before
 * a restart is found here, so nothing is lost between the commit and the read.
 */
export async function settlePendingSearches(
  pool: Pool,
  config: ProcessingConfig,
  search: MatchSearch,
  limit = MATCH_SWEEP_LIMIT,
) {
  const outcomes: string[] = []
  for (const request of await pendingRequests(pool, config, limit)) {
    if (await discardIfReplaced(pool, request)) {
      outcomes.push('discarded')
      continue
    }
    const result = await search(request)
    outcomes.push(
      await transaction(pool, (client) => settleInTransaction(client, config, request, result)),
    )
  }
  return outcomes
}
