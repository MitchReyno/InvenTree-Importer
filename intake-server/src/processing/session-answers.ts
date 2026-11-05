import { randomUUID } from 'node:crypto'
import { and, eq, getTableColumns, sql } from 'drizzle-orm'
import type { PoolClient } from 'pg'
import type { CaptureEditDto, ProcessingAnswerDto } from '@invimport/contracts'
import { executeDatabaseQuery, queryDatabase } from '../db/database.ts'
import { appendEvent } from '../db/authority.ts'
import { appendSessionInbox } from '../agents/tools/inbox.ts'
import type { ProcessingConfig } from './attempts.ts'
import { fail, sealed } from './model.ts'
import { retainedSessionQuestion } from './retained.ts'
import {
  processingAnswers,
  processingAttempts,
  processingInputs,
  processingMessages,
  processingQuestions,
} from './schema.ts'
import { lockProcessingAttempt } from './state.ts'

interface LockedCapture {
  streamId: string
  apply: (edit: CaptureEditDto) => Promise<{ revision: string }>
  publish: () => Promise<unknown>
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
  if (!current || job.subject_id === null) {
    fail('stale_question', 412)
  }
  const ask = retainedSessionQuestion(question, job.subject_id)
  if (ask.kind !== input.value.kind) {
    fail('invalid_answer', 422)
  }
  const snapshot = await capture.apply(
    input.value.kind === 'quantity'
      ? {
          expected_revision: input.expected_capture_revision,
          change: {
            kind: 'lot',
            id: job.subject_id,
            quantity: { mode: 'set', value: input.value.value },
          },
        }
      : {
          expected_revision: input.expected_capture_revision,
          change: { kind: 'note', subject_id: job.subject_id, text: input.value.text },
        },
  )
  const answerId = randomUUID()
  const value = sealed({ ...input, question_id: questionId })
  await executeDatabaseQuery(
    queryDatabase(client).insert(processingAnswers).values({
      id: answerId,
      jobId: job.id,
      questionId,
      actorId: config.actorId,
      valueBytes: value.bytes,
      valueDigest: value.digest,
      // No continuation attempt: the same session receives the answer.
      continuationAttemptId: attempt.id,
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
      payload: { question_id: questionId, answer_id: answerId, value: input.value },
    },
    { publish: false },
  )
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
