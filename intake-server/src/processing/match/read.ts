import type { Pool, PoolClient } from 'pg'
import { and, desc, eq, inArray, ne } from 'drizzle-orm'
import { strictJson } from '@invimport/contracts/json'
import {
  validate,
  type BatchMatchDto,
  type MatchAnswerRecordDto,
  type MatchLotDto,
  type MatchQuestionDto,
} from '@invimport/contracts'
import { executeDatabaseQuery, queryDatabase, transaction } from '#/db/database.ts'
import { sha256 } from '#/db/authority.ts'
import { captureInTransaction } from '#/capture/repository.ts'
import type { ProcessingConfig } from '#/processing/attempts.ts'
import { batchInputVersion } from '#/processing/stage-policy.ts'
import { searchable } from './keys.ts'
import type { MatchResult } from './outcome.ts'
import {
  processingMatchAnswers,
  processingMatches,
  processingMatchQuestions,
  processingMatchSearches,
} from './schema.ts'
import {
  currentOutcome,
  decodeIdentity,
  decodeRequest,
  searchPending,
  type MatchRow,
} from './state.ts'
import { decodeQuestionContent } from './stored-question.ts'

/** The read lists every open question (at most one per lot) and fills the rest with history. */
const MAX_READ_QUESTIONS = 200

function decodeResult(bytes: Buffer, digest: Buffer): MatchResult {
  if (!sha256(bytes).equals(digest)) {
    throw new Error('match_result_corrupt')
  }
  return strictJson(bytes.toString('utf8')) as MatchResult
}

async function searchRow(client: PoolClient, lotId: string, generation: bigint) {
  const rows = await executeDatabaseQuery(
    queryDatabase(client)
      .select()
      .from(processingMatchSearches)
      .where(
        and(
          eq(processingMatchSearches.lotId, lotId),
          eq(processingMatchSearches.generation, generation),
        ),
      ),
  )
  return rows[0]
}

/** One lot as Match has it: its latest request's keys and its latest settled search's findings. */
async function lotOf(client: PoolClient, row: MatchRow): Promise<MatchLotDto> {
  const requested = await searchRow(client, row.lotId, row.searchGeneration)
  const keys = requested ? decodeRequest(requested.requestBytes).keys : []
  const settled =
    row.settledGeneration > 0n
      ? await searchRow(client, row.lotId, row.settledGeneration)
      : undefined
  const result =
    settled?.resultBytes && settled.resultDigest
      ? decodeResult(settled.resultBytes, settled.resultDigest)
      : undefined
  const outcome = await currentOutcome(client, row)
  const target = outcome?.targetPartPk
    ? result?.candidates.find(
        (candidate) => candidate.kind === 'part' && candidate.part.pk === outcome.targetPartPk,
      )
    : undefined
  return {
    lot_id: row.lotId,
    identity: decodeIdentity(row),
    state: searchPending(row) ? 'searching' : row.state,
    generation: row.searchGeneration.toString(),
    settled_generation: row.settledGeneration.toString() as MatchLotDto['settled_generation'],
    keys,
    searchable: searchable(keys),
    ...(result && result.searched !== 'unavailable' ? { verdict: result.verdict } : {}),
    candidates: result?.candidates ?? [],
    ...(result?.contribution ? { contribution: result.contribution } : {}),
    ...(outcome ? { outcome: outcome.outcome } : {}),
    ...(outcome?.targetPartPk
      ? {
          target: {
            part_pk: outcome.targetPartPk,
            name: target?.kind === 'part' ? target.part.name : `Part ${outcome.targetPartPk}`,
          },
        }
      : {}),
    waits: row.waits,
    ...(row.questionId ? { question_id: row.questionId } : {}),
    ...(settled?.settledAt ? { searched_at: settled.settledAt.toISOString() } : {}),
    ...(outcome?.outcome.basis.kind === 'decision'
      ? { decided_at: outcome.recordedAt.toISOString() }
      : {}),
  }
}

async function questionsOf(client: PoolClient, batchId: string): Promise<MatchQuestionDto[]> {
  // Every open question first, since each holds its lot, then the newest of the rest.
  const open = await executeDatabaseQuery(
    queryDatabase(client)
      .select()
      .from(processingMatchQuestions)
      .where(
        and(
          eq(processingMatchQuestions.batchId, batchId),
          eq(processingMatchQuestions.state, 'open'),
        ),
      )
      .orderBy(desc(processingMatchQuestions.askedAt), processingMatchQuestions.id),
  )
  const closed = await executeDatabaseQuery(
    queryDatabase(client)
      .select()
      .from(processingMatchQuestions)
      .where(
        and(
          eq(processingMatchQuestions.batchId, batchId),
          ne(processingMatchQuestions.state, 'open'),
        ),
      )
      .orderBy(desc(processingMatchQuestions.askedAt), processingMatchQuestions.id)
      .limit(Math.max(0, MAX_READ_QUESTIONS - open.length)),
  )
  const rows = [...open, ...closed].sort(
    (a, b) => b.askedAt.getTime() - a.askedAt.getTime() || a.id.localeCompare(b.id),
  )
  const answers = rows.length
    ? await executeDatabaseQuery(
        queryDatabase(client)
          .select()
          .from(processingMatchAnswers)
          .where(
            inArray(
              processingMatchAnswers.questionId,
              rows.map((row) => row.id),
            ),
          ),
      )
    : []
  return rows.reverse().map((row) => {
    const content = decodeQuestionContent(row)
    const answer = answers.find((item) => item.questionId === row.id)
    let record: MatchAnswerRecordDto | undefined
    if (answer) {
      if (!sha256(answer.answerBytes).equals(answer.answerDigest)) {
        throw new Error('match_answer_corrupt')
      }
      record = strictJson(answer.answerBytes.toString('utf8')) as MatchAnswerRecordDto
    }
    return {
      id: row.id,
      lot_id: row.lotId,
      revision: row.generation.toString(),
      state: row.state,
      kind: row.kind,
      title: content.title,
      reason: content.reason,
      steps: content.steps,
      keys: content.keys,
      candidates: content.candidates,
      notes: content.notes,
      ...(content.contribution ? { contribution: content.contribution } : {}),
      asked_at: row.askedAt.toISOString(),
      ...(record ? { answer: record } : {}),
    }
  })
}

/** A batch's Match step, read in one repeatable-read snapshot. */
export async function readBatchMatch(
  pool: Pool,
  config: ProcessingConfig,
  batchId: string,
): Promise<BatchMatchDto> {
  return transaction(pool, async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const capture = await captureInTransaction(client, config, batchId)
    const version = await batchInputVersion(client, config, batchId)
    const rows = await executeDatabaseQuery(
      queryDatabase(client)
        .select()
        .from(processingMatches)
        .where(eq(processingMatches.batchId, batchId))
        .orderBy(processingMatches.lotId),
    )
    // A lot Review retired is gone: its Match state isn't listed and its questions read superseded.
    const retired = new Set(
      capture.snapshot.lots.filter((lot) => lot.retired === true).map((lot) => lot.id),
    )
    const lots: MatchLotDto[] = []
    for (const row of rows.filter((item) => !retired.has(item.lotId))) {
      lots.push(await lotOf(client, row))
    }
    const read: BatchMatchDto = {
      batch_id: batchId,
      capture_revision: capture.snapshot.revision,
      pipeline: version === 'bench-intake-input/7' ? 'match' : 'inventory',
      lots,
      questions: (await questionsOf(client, batchId)).map((question) =>
        retired.has(question.lot_id) && question.state === 'open'
          ? { ...question, state: 'superseded' as const }
          : question,
      ),
    }
    validate('BatchMatch', read)
    return read
  })
}

/** The Match state of one lot, or of every lot of the batch when none is named, for a brief. */
export async function readMatchLots(client: PoolClient, batchId: string, lotId: string | null) {
  const rows = await executeDatabaseQuery(
    queryDatabase(client)
      .select()
      .from(processingMatches)
      .where(
        lotId === null
          ? eq(processingMatches.batchId, batchId)
          : and(eq(processingMatches.batchId, batchId), eq(processingMatches.lotId, lotId)),
      )
      .orderBy(processingMatches.lotId),
  )
  const lots: MatchLotDto[] = []
  for (const row of rows) {
    lots.push(await lotOf(client, row))
  }
  return lots
}
