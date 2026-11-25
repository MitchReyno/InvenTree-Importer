import { randomUUID } from 'node:crypto'
import { and, eq, getTableColumns, sql } from 'drizzle-orm'
import type { PoolClient } from 'pg'
import {
  questionView,
  type CaptureEditDto,
  type ProcessingAnswerDto,
  type ProcessingAnswerV1Dto,
  type ProcessingAnswerV2Dto,
  type CaptureSnapshotDto,
  type SessionAskArgsDto,
  type SessionAskArgsV2Dto,
  type SessionAnswerPayloadDto,
} from '@invimport/contracts'
import { executeDatabaseQuery, queryDatabase } from '#/db/database.ts'
import { appendEvent } from '#/db/authority.ts'
import { appendSessionInbox } from '#/agents/tools/inbox.ts'
import { changeText, fieldsSuperseded } from './currentness.ts'
import { answeredValues, answerValueText } from './answer-summary.ts'
import { storedQuestionView } from './brief.ts'
import type { ProcessingConfig } from './attempts.ts'
import { fail, sealed } from './model.ts'
import { retainedSessionQuestion } from './retained.ts'
import { steppedAnswerEffects } from './stepped-answers.ts'
import {
  processingAnswers,
  processingAttempts,
  processingInputs,
  processingMessages,
  processingQuestions,
} from './schema.ts'
import { captureSubjects } from '#/capture/schema.ts'
import { captureInTransaction, quantityText } from '#/capture/repository.ts'
import { lockProcessingAttempt } from './state.ts'

interface LockedCapture {
  streamId: string
  applyInOrder: (edits: readonly CaptureEditDto[]) => Promise<{ revision: string }>
  publish: () => Promise<unknown>
}

/** The inbox payload limit for every kind but instructions (migration 0030). */
const MAX_SESSION_INBOX_PAYLOAD_BYTES = 32768

type AnswerIdentity = { question_id: string; answer_id: string }

interface AnswerPlan {
  /** The capture edits, in order, each against the revision the one before produced. */
  edits: (expectedRevision: string) => CaptureEditDto[]
  inboxPayload: SessionAnswerPayloadDto
  /** Stepped payloads hold free text in several steps, so only they can outgrow the limit. */
  checkPayload: boolean
  title: string
}

function nextRevision(revision: string) {
  return (BigInt(revision) + 1n).toString()
}

function quantityEdit(expectedRevision: string, lotId: string, value: string): CaptureEditDto {
  return {
    expected_revision: expectedRevision,
    change: { kind: 'lot', id: lotId, quantity: { mode: 'set', value } },
  }
}

function noteEdit(
  expectedRevision: string,
  subjectId: string | null,
  text: string,
): CaptureEditDto {
  return {
    expected_revision: expectedRevision,
    change: { kind: 'note', subject_id: subjectId, text },
  }
}

/** A `/1` question takes a `/1` answer of its own kind: one quantity or one note. */
function singleAnswerPlan(
  ask: SessionAskArgsDto,
  input: ProcessingAnswerV1Dto,
  subjectId: string | null,
  identity: AnswerIdentity,
): AnswerPlan {
  const { value } = input
  if (ask.kind !== value.kind || (value.kind === 'quantity' && subjectId === null)) {
    fail('invalid_answer', 422)
  }
  return {
    edits: (expectedRevision) => [
      value.kind === 'quantity'
        ? quantityEdit(expectedRevision, subjectId!, value.value)
        : noteEdit(expectedRevision, subjectId, value.text),
    ],
    inboxPayload: { ...identity, value },
    checkPayload: false,
    title: ask.prompt,
  }
}

/** A `/2` question takes one value per step: at most a quantity edit, then one note edit. */
function steppedAnswerPlan(
  ask: SessionAskArgsV2Dto,
  input: ProcessingAnswerV2Dto,
  subjectId: string | null,
  identity: AnswerIdentity,
): AnswerPlan {
  const effects = steppedAnswerEffects(ask, input)
  const quantity = effects.quantity
  if (quantity && subjectId === null) {
    fail('invalid_answer', 422)
  }
  return {
    edits: (expectedRevision) => {
      const edits: CaptureEditDto[] = []
      let revision = expectedRevision
      if (quantity) {
        edits.push(quantityEdit(revision, subjectId!, quantity.value))
        revision = nextRevision(revision)
      }
      if (effects.note !== undefined) {
        edits.push(noteEdit(revision, subjectId, effects.note))
      }
      return edits
    },
    inboxPayload: { ...identity, steps: effects.delivered },
    checkPayload: true,
    title: questionView(ask).title,
  }
}

function answerPlan(
  ask: SessionAskArgsDto | SessionAskArgsV2Dto,
  input: ProcessingAnswerDto,
  subjectId: string | null,
  identity: AnswerIdentity,
): AnswerPlan {
  const stepped = 'steps' in ask
  if (stepped && input.schema_version === 'bench-intake-answer/2') {
    return steppedAnswerPlan(ask, input, subjectId, identity)
  }
  if (!stepped && input.schema_version === 'bench-intake-answer/1') {
    return singleAnswerPlan(ask, input, subjectId, identity)
  }
  return fail('invalid_answer', 422)
}

/**
 * Escaped text can outgrow the inbox payload limit while the note fits, so measure it as the
 * constraint does, as PostgreSQL's jsonb text, before any edit.
 */
async function requireInboxPayloadFits(client: PoolClient, payload: SessionAnswerPayloadDto) {
  const measured = await client.query<{ bytes: number }>(
    'SELECT octet_length($1::jsonb::text)::int AS bytes',
    [JSON.stringify(payload)],
  )
  if (measured.rows[0].bytes > MAX_SESSION_INBOX_PAYLOAD_BYTES) {
    fail('invalid_answer', 422)
  }
}

/**
 * What an answer changed in each field it settles, as a `/7` session is told: a quantity answer
 * changes the lot's quantity from what Capture held before to what it holds now; any other field
 * gains the operator's answer, which the answer's note records.
 */
function answeredChanges(
  ask: SessionAskArgsDto | SessionAskArgsV2Dto,
  input: ProcessingAnswerDto,
  subjectId: string | null,
  before: CaptureSnapshotDto,
  after: CaptureSnapshotDto,
) {
  const view = storedQuestionView(ask, 'assumption' in ask ? ask.assumption : null)
  const values = answeredValues(view, input).map((value) => value.value)
  const words = values
    .filter((value) => value.kind !== 'quantity' && value.kind !== 'number')
    .map(answerValueText)

  const quantityOf = (snapshot: CaptureSnapshotDto) =>
    quantityText(snapshot.lots.find((lot) => lot.id === subjectId)?.quantity)

  return ask.fields.map((field) => {
    if (field === 'quantity' && subjectId) {
      return {
        kind: 'field' as const,
        subject_id: subjectId,
        field,
        from: quantityOf(before),
        to: quantityOf(after),
      }
    }
    return {
      kind: 'field' as const,
      subject_id: subjectId,
      field,
      from: null,
      to: words.length ? changeText(words.join('; ')) : null,
    }
  })
}

/**
 * A session question does not block its session. The answer is the same human capture edit as
 * for earlier profiles, and it reaches the running or resumable session as an inbox item.
 */
export async function answerSessionQuestion(
  client: PoolClient,
  config: ProcessingConfig,
  capture: LockedCapture,
  batchId: string,
  questionId: string,
  input: ProcessingAnswerDto,
) {
  const rows = await executeDatabaseQuery(
    queryDatabase(client)
      .select({
        ...getTableColumns(processingQuestions),
        commandId: processingAttempts.commandId,
        manifestDigest: processingInputs.manifestDigest,
        envelopeBytes: processingMessages.envelopeBytes,
        envelopeDigest: processingMessages.envelopeDigest,
        disposition: processingMessages.disposition,
      })
      .from(processingQuestions)
      .innerJoin(processingAttempts, eq(processingAttempts.id, processingQuestions.attemptId))
      .innerJoin(processingInputs, eq(processingInputs.id, processingQuestions.inputId))
      .innerJoin(processingMessages, eq(processingMessages.id, processingQuestions.messageId))
      .where(and(eq(processingQuestions.batchId, batchId), eq(processingQuestions.id, questionId))),
  )
  const question = rows[0] ?? fail('question_not_found', 404)
  const { job, attempt } = await lockProcessingAttempt(client, question.jobId, input.attempt_id)
  const locked = await executeDatabaseQuery(
    queryDatabase(client)
      .select({
        state: processingQuestions.state,
        revision: sql<string>`${processingQuestions.revision}::text`,
      })
      .from(processingQuestions)
      .where(eq(processingQuestions.id, questionId))
      .for('update'),
  )
  const current =
    locked[0].state === 'open' &&
    locked[0].revision === input.expected_question_revision &&
    question.attemptId === attempt.id &&
    job.current_attempt_id === attempt.id &&
    question.manifestDigest.toString('hex') === input.input_sha256
  if (!current) {
    fail('stale_question', 412)
  }
  // A lead-session question names its own subject, or none for the whole batch.
  const batchSubjects =
    job.subject_id === null
      ? new Set(
          (
            await executeDatabaseQuery(
              queryDatabase(client)
                .select({ id: captureSubjects.id })
                .from(captureSubjects)
                .where(eq(captureSubjects.batchId, batchId)),
            )
          ).map((row) => row.id),
        )
      : undefined
  const ask = retainedSessionQuestion(question, job.subject_id, batchSubjects)
  const subjectId = job.subject_id ?? ask.subject_id
  const answerId = randomUUID()
  const plan = answerPlan(ask, input, subjectId, { question_id: questionId, answer_id: answerId })
  if (plan.checkPayload) {
    await requireInboxPayloadFits(client, plan.inboxPayload)
  }
  const before = await captureInTransaction(client, config, batchId)
  const snapshot = await capture.applyInOrder(plan.edits(input.expected_capture_revision))
  const after = await captureInTransaction(client, config, batchId)
  const value = sealed({ ...input, question_id: questionId })
  await executeDatabaseQuery(
    queryDatabase(client)
      .insert(processingAnswers)
      .values({
        id: answerId,
        jobId: job.id,
        questionId,
        actorId: config.actorId,
        valueBytes: value.bytes,
        valueDigest: value.digest,
        // No continuation attempt: the same session receives the answer.
        continuationAttemptId: attempt.id,
        captureRevision: BigInt(snapshot.revision),
      }),
  )
  await executeDatabaseQuery(
    queryDatabase(client)
      .update(processingQuestions)
      .set({ state: 'answered', revision: sql`${processingQuestions.revision}+1` })
      .where(eq(processingQuestions.id, questionId)),
  )
  await appendSessionInbox(
    client,
    {
      binding: config,
      lineageId: job.id,
      actorId: config.actorId,
      idempotencyKey: `answer:${questionId}`,
      kind: 'answer',
      payload: plan.inboxPayload,
    },
    { publish: false },
  )
  // Every other session relying on the answered fields is told, and their proposals are stale.
  await fieldsSuperseded(client, {
    batchId,
    subjectId,
    fields: ask.fields,
    reason: 'answer_received',
    message: `A question was answered: ${plan.title}`,
    key: `answer:${questionId}`,
    except: job.id,
    changes: answeredChanges(ask, input, subjectId, before.snapshot, after.snapshot),
    context: { origin: { by: 'operator' }, briefRevision: snapshot.revision },
  })
  await capture.publish()
  await appendEvent(client, capture.streamId, 'processing_changed', { batch_id: batchId })
  return {
    answer_id: answerId,
    question_id: questionId,
    attempt_id: attempt.id,
    capture_revision: snapshot.revision,
    command_id: question.commandId,
  }
}
