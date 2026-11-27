import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { and, eq } from 'drizzle-orm'
import { canonicalRecord } from '@invimport/contracts/json'
import {
  validate,
  type CaptureSnapshotDto,
  type MatchAnswerDto,
  type MatchAnswerRecordDto,
  type MatchBatchAnswerDto,
  type MatchPartCandidateDto,
} from '@invimport/contracts'
import { executeDatabaseQuery, queryDatabase, transaction } from '#/db/database.ts'
import { appendEvent, idempotent, sha256 } from '#/db/authority.ts'
import {
  captureInTransaction,
  lockCaptureForOperatorCommand,
  type OperatorCommandScope,
} from '#/capture/repository.ts'
import { requireCurrentTargetContext } from '#/capture/target-context.ts'
import type { ProcessingConfig } from '../attempts.ts'
import { fail } from '../model.ts'
import { commandScope } from '../scope.ts'
import { coveredOf, decisionModes } from './outcome.ts'
import { MATCH_STEP_ID, questionOptions, type MatchOptionEffect } from './questions.ts'
import { processingMatchAnswers, processingMatchQuestions } from './schema.ts'
import {
  closeQuestion,
  lotMedia,
  queueWithinSavepoint,
  recordOutcome,
  tellOutcome,
} from './settle.ts'
import { lockMatch, readMatch, searchPending, type MatchRow } from './state.ts'
import { decodeQuestionContent, type StoredQuestion } from './stored-question.ts'

type QuestionRow = typeof processingMatchQuestions.$inferSelect

/** One question's answer as the command reads it: the option chosen, or Something else. */
interface Choice {
  questionId: string
  expectedRevision: string
  value: { optionId: string } | { other: string }
}

/** A question, with the decision its answer makes, checked against what it offered. */
interface Planned {
  choice: Choice
  question: QuestionRow
  content: StoredQuestion
  effect: MatchOptionEffect | { kind: 'other'; text: string }
}

async function questionRow(client: PoolClient, batchId: string, questionId: string) {
  const rows = await executeDatabaseQuery(
    queryDatabase(client)
      .select()
      .from(processingMatchQuestions)
      .where(
        and(
          eq(processingMatchQuestions.id, questionId),
          eq(processingMatchQuestions.batchId, batchId),
        ),
      ),
  )
  return rows[0] ?? fail('not_found', 404)
}

/** What the chosen option does; an option the question didn't offer is refused. */
function plan(question: QuestionRow, choice: Choice): Planned {
  const content = decodeQuestionContent(question)
  if ('other' in choice.value) {
    const step = content.steps[0]
    if (step.answer.kind !== 'choice' || !step.answer.other) {
      fail('invalid_match_answer', 422)
    }
    return { choice, question, content, effect: { kind: 'other', text: choice.value.other } }
  }
  const optionId = choice.value.optionId
  const option = questionOptions(content.kind, content.candidates).find(
    (candidate) => candidate.id === optionId,
  )
  if (!option) {
    return fail('invalid_match_answer', 422)
  }
  return { choice, question, content, effect: option.effect }
}

/**
 * Whether the question can still be answered: it is the lot's open question, asked from the
 * search the answer names, and no newer search has been requested since.
 */
function stillAnswerable(row: MatchRow | undefined, planned: Planned) {
  return (
    row !== undefined &&
    planned.question.state === 'open' &&
    row.questionId === planned.question.id &&
    planned.question.generation.toString() === planned.choice.expectedRevision
  )
}

/**
 * Refuses an answer Match can't take now: a question replaced or closed is stale for good, while
 * one whose lot has a newer search pending can be answered again once that search settles.
 */
function requireAnswerable(row: MatchRow | undefined, planned: Planned, retired: boolean) {
  if (retired || !stillAnswerable(row, planned)) {
    fail('stale_question', 409)
  }
  if (searchPending(row!)) {
    fail('match_waiting', 409)
  }
}

function candidateFor(content: StoredQuestion, partPk: string | undefined) {
  return content.candidates.find(
    (candidate): candidate is MatchPartCandidateDto =>
      candidate.kind === 'part' && candidate.part.pk === partPk,
  )
}

/**
 * Binds the lot to the Part its decision targets, in Capture: add stock and fill what's missing
 * relink only this lot to the batch's Part subject for that InvenTree Part (reused when one
 * exists), writing the Part's retained observation from Match's read when Capture has none; a new
 * Part decision moves a lot off an existing Part onto a draft of its own. Its peers keep theirs.
 * Returns whether Capture changed.
 */
/** Part subjects and observations a batch answer has made so far, by InvenTree Part. */
interface Bound {
  subjects: Map<string, string>
  observations: Map<string, CaptureSnapshotDto['observations'][number]>
}

async function bindTarget(
  scope: OperatorCommandScope,
  config: ProcessingConfig,
  snapshot: CaptureSnapshotDto,
  lotId: string,
  planned: Planned,
  bound: Bound,
) {
  if (planned.effect.kind !== 'decision') {
    return false
  }
  const lot = snapshot.lots.find((candidate) => candidate.id === lotId)
  if (!lot || lot.retired === true) {
    return fail('subject_retired', 409)
  }
  const decision = planned.effect.decision
  if (decision === 'new_part') {
    const part = snapshot.parts.find((candidate) => candidate.id === lot.part_subject_id)
    if (part?.choice.mode !== 'set') {
      return false
    }
    const draft = await scope.addPart(lot.label)
    await scope.setLotPart(lotId, draft)
    await scope.touchSubject(lotId)
    return true
  }
  if (decision !== 'add_stock' && decision !== 'fill_gaps') {
    return false
  }
  const candidate =
    candidateFor(planned.content, planned.effect.partPk) ?? fail('invalid_match_answer', 422)
  const pk = candidate.part.pk
  const context = config.targetContextId
  let observation =
    bound.observations.get(pk) ??
    snapshot.observations.find(
      (item) => item.model === 'part' && item.pk === pk && item.target_context_id === context,
    )
  if (!observation) {
    observation = {
      id: randomUUID(),
      model: 'part',
      pk,
      target_context_id: context,
      label: candidate.part.name,
      observed_at: new Date().toISOString(),
    }
    await scope.retainObservation(observation)
    bound.observations.set(pk, observation)
  }
  let subject =
    bound.subjects.get(pk) ??
    snapshot.parts.find(
      (part) =>
        part.choice.mode === 'set' &&
        part.choice.value.pk === pk &&
        part.choice.value.target_context_id === context,
    )?.id
  if (!subject) {
    subject = await scope.addPart(candidate.part.name)
    await scope.setPartChoice(subject, {
      mode: 'set',
      value: { observation_id: observation.id, target_context_id: context, model: 'part', pk },
    })
    bound.subjects.set(pk, subject)
  }
  if (lot.part_subject_id === subject) {
    return false
  }
  await scope.setLotPart(lotId, subject)
  await scope.touchSubject(lotId)
  return true
}

async function recordAnswer(
  client: PoolClient,
  config: ProcessingConfig,
  planned: Planned,
  batch: boolean,
) {
  const record: MatchAnswerRecordDto = {
    answered_at: new Date().toISOString(),
    ...(planned.effect.kind === 'decision'
      ? {
          decision: planned.effect.decision,
          ...(planned.effect.partPk ? { part_pk: planned.effect.partPk } : {}),
        }
      : {}),
    ...(planned.effect.kind === 'other' ? { text: planned.effect.text } : {}),
    ...(batch ? { batch: true as const } : {}),
  }
  const bytes = Buffer.from(canonicalRecord(record))
  await executeDatabaseQuery(
    queryDatabase(client)
      .insert(processingMatchAnswers)
      .values({
        questionId: planned.question.id,
        batchId: planned.question.batchId,
        actorId: config.actorId,
        answerBytes: bytes,
        answerDigest: sha256(bytes),
      }),
  )
}

/**
 * Applies answers: the decisions bind their lots' targets in Capture, then, under each lot's
 * Match lock, every question is checked to be still answerable, the answers and outcomes are
 * recorded, and the stages the outcomes run are queued. All or nothing.
 */
async function applyAnswers(
  client: PoolClient,
  config: ProcessingConfig,
  batchId: string,
  choices: readonly Choice[],
) {
  const peek = await captureInTransaction(client, config, batchId, true)
  if (peek.snapshot.archived) {
    fail('batch_archived', 409)
  }
  const planned = await Promise.all(
    choices.map(async (choice) =>
      plan(await questionRow(client, batchId, choice.questionId), choice),
    ),
  )
  // Refused before any write when a question can't be answered now; checked again under lock.
  const retired = new Set(
    peek.snapshot.lots.filter((lot) => lot.retired === true).map((lot) => lot.id),
  )
  for (const item of planned) {
    requireAnswerable(
      await readMatch(client, item.question.lotId),
      item,
      retired.has(item.question.lotId),
    )
  }
  await requireCurrentTargetContext(client, config)
  const scope = await lockCaptureForOperatorCommand(client, config, batchId, peek.snapshot.revision)
  let changed = false
  const bound: Bound = { subjects: new Map(), observations: new Map() }
  const byLot = [...planned].sort((a, b) => a.question.lotId.localeCompare(b.question.lotId))
  for (const item of byLot) {
    const relinked = await bindTarget(
      scope,
      config,
      scope.snapshot,
      item.question.lotId,
      item,
      bound,
    )
    changed = relinked || changed
  }
  const snapshot = changed
    ? await scope.commit(
        { kind: 'match_decision', question_ids: planned.map((item) => item.question.id) },
        { tell: false, publish: false },
      )
    : scope.snapshot
  const media = new Map<string, Awaited<ReturnType<typeof lotMedia>>>()
  for (const lotId of [...new Set(planned.map((item) => item.question.lotId))].sort()) {
    media.set(lotId, await lotMedia(client, config, snapshot, lotId))
  }
  for (const item of byLot) {
    const row = await lockMatch(client, item.question.lotId)
    requireAnswerable(row, item, retired.has(item.question.lotId))
    await settleAnswer(
      client,
      config,
      snapshot,
      row!,
      item,
      choices.length > 1,
      media.get(row!.lotId),
    )
  }
  if (changed) {
    await scope.publish()
  }
  await appendEvent(client, peek.streamId, 'processing_changed', { batch_id: batchId })
  return {
    batch_id: batchId,
    question_ids: planned.map((item) => item.question.id),
    capture_revision: snapshot.revision,
  }
}

/** Records one answer under the lot's Match lock, and its decision's outcome and stages. */
async function settleAnswer(
  client: PoolClient,
  config: ProcessingConfig,
  snapshot: CaptureSnapshotDto,
  row: MatchRow,
  planned: Planned,
  batch: boolean,
  media: Awaited<ReturnType<typeof lotMedia>>,
) {
  await recordAnswer(client, config, planned, batch)
  await closeQuestion(client, row, 'answered')
  if (planned.effect.kind !== 'decision') {
    // Something else, or kept held: no decision; the lot stays held until Check again asks again.
    await client.query(
      `UPDATE public.processing_match SET state='held', waits=ARRAY['research','images']::text[],
         question_id=NULL, updated_at=now() WHERE lot_id=$1`,
      [row.lotId],
    )
    return
  }
  const candidate = candidateFor(planned.content, planned.effect.partPk)
  const outcome = await recordOutcome(client, row, {
    basis: { kind: 'decision', decision: planned.effect.decision },
    modes: decisionModes(planned.effect.decision, candidate),
    covered: coveredOf(planned.content),
    generation: planned.question.generation,
    targetPartPk: candidate?.part.pk,
    questionId: planned.question.id,
  })
  const revision = BigInt(outcome.revision)
  await client.query(
    `UPDATE public.processing_match SET state='decided', waits='{}'::text[], outcome_revision=$2,
       question_id=NULL, updated_at=now() WHERE lot_id=$1`,
    [row.lotId, revision.toString()],
  )
  await tellOutcome(
    client,
    row.batchId,
    row.lotId,
    row.outcomeRevision,
    revision,
    snapshot.revision,
  )
  await queueWithinSavepoint(
    client,
    config,
    snapshot,
    row.lotId,
    outcome,
    { ...row, outcomeRevision: revision },
    media,
  )
}

function choiceOf(questionId: string, body: MatchAnswerDto): Choice {
  const step = body.steps[0]
  if (step.step_id !== MATCH_STEP_ID) {
    return fail('invalid_match_answer', 422)
  }
  if (step.value.kind === 'choice' && 'option_id' in step.value) {
    return {
      questionId,
      expectedRevision: body.expected_question_revision,
      value: { optionId: step.value.option_id },
    }
  }
  if (step.value.kind === 'choice' && 'other' in step.value) {
    return {
      questionId,
      expectedRevision: body.expected_question_revision,
      value: { other: step.value.other },
    }
  }
  return fail('invalid_match_answer', 422)
}

/** The operator's answer to one match question. */
export async function answerMatchQuestion(
  pool: Pool,
  config: ProcessingConfig,
  batchId: string,
  questionId: string,
  key: string,
  body: MatchAnswerDto,
) {
  validate('MatchAnswer', body)
  const choice = choiceOf(questionId, body)
  return transaction(pool, (client) =>
    idempotent(
      client,
      commandScope(config, 'match_answer', batchId, key),
      { question_id: questionId, ...body },
      () => applyAnswers(client, config, batchId, [choice]),
    ),
  )
}

/** Several exact matches answered as one, each question under its own pin, all or nothing. */
export async function answerMatchBatch(
  pool: Pool,
  config: ProcessingConfig,
  batchId: string,
  key: string,
  body: MatchBatchAnswerDto,
) {
  validate('MatchBatchAnswer', body)
  const ids = body.answers.map((answer) => answer.question_id)
  if (new Set(ids).size !== ids.length) {
    fail('invalid_match_answer', 422)
  }
  const choices = body.answers.map((answer): Choice => ({
    questionId: answer.question_id,
    expectedRevision: answer.expected_question_revision,
    value: { optionId: answer.option_id },
  }))
  return transaction(pool, (client) =>
    idempotent(client, commandScope(config, 'match_batch_answer', batchId, key), body, () =>
      applyAnswers(client, config, batchId, choices),
    ),
  )
}
