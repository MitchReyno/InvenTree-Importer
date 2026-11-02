import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { validate, type CaptureEditDto, type ProcessingAnswerDto } from '@invimport/contracts'
import { transaction } from '../db/database.ts'
import { appendEvent, idempotent } from '../db/authority.ts'
import { captureInTransaction } from '../capture/repository.ts'
import type { LockCapture } from './capture.ts'
import { channelToken, createAttempt, type ProcessingConfig } from './attempts.ts'
import { commandScope, lockLane } from './scope.ts'
import { fail, unseal, sealed, decodeProcessingInput } from './model.ts'
import { lockProcessingAttempt } from './state.ts'
import { loadRetainedQuestionSpec } from './retained.ts'
import { continueDependentJobs, continuationSubjectIds } from './continuations.ts'
import { prepareMediaTransaction } from '../media/transaction.ts'
import { decodeMediaInputs } from '../media/inputs.ts'
import { reserveProcessingMedia, reservedMediaFor } from './media.ts'
import { loadProcessingAuthority, processingInputIsCurrent } from './authority.ts'
import { processingDependencyStatus } from './dependencies.ts'

type QuestionRow = {
  id: string
  job_id: string
  attempt_id: string
  input_id: string
  revision: string
  state: 'open' | 'answered' | 'superseded'
  spec_bytes: Buffer
  spec_digest: Buffer
}

async function adoptRetainedAnswer(
  client: PoolClient,
  config: ProcessingConfig,
  batchId: string,
  questionId: string,
  input: ProcessingAnswerDto,
) {
  const answers = await client.query(
    `SELECT answer.*,input.capture_revision,continuation.command_id
     FROM processing_answer answer
     JOIN processing_question question ON question.id=answer.question_id
     JOIN processing_attempt continuation ON continuation.id=answer.continuation_attempt_id
     JOIN processing_input input ON input.id=continuation.input_id
     WHERE question.batch_id=$1 AND question.id=$2 AND answer.actor_id=$3`,
    [batchId, questionId, config.actorId],
  )
  const answer = answers.rows[0]
  if (!answer) {
    return null
  }

  unseal(answer.value_bytes, answer.value_digest)
  const expected = sealed({ ...input, question_id: questionId })
  if (!answer.value_bytes.equals(expected.bytes)) {
    fail('payload_conflict')
  }

  return {
    answer_id: answer.id,
    question_id: questionId,
    attempt_id: answer.continuation_attempt_id,
    capture_revision: answer.capture_revision,
    command_id: answer.command_id,
  }
}

async function lockCurrentQuestion(
  client: PoolClient,
  batchId: string,
  questionId: string,
  input: ProcessingAnswerDto,
) {
  const references = await client.query<QuestionRow>(
    'SELECT * FROM processing_question WHERE batch_id=$1 AND id=$2',
    [batchId, questionId],
  )
  const reference = references.rows[0] ?? fail('question_not_found', 404)
  const { job, attempt } = await lockProcessingAttempt(client, reference.job_id, input.attempt_id)
  const questions = await client.query<QuestionRow>(
    'SELECT * FROM processing_question WHERE batch_id=$1 AND id=$2 FOR UPDATE',
    [batchId, questionId],
  )
  const question = questions.rows[0]
  const currentQuestion =
    question.state === 'open' &&
    question.revision === input.expected_question_revision &&
    question.attempt_id === input.attempt_id &&
    question.input_id === attempt.input_id
  const waitingAttempt =
    job.current_attempt_id === attempt.id &&
    job.state === 'waiting_for_user' &&
    attempt.state === 'waiting_for_user'

  if (!currentQuestion || !waitingAttempt) {
    fail('stale_question', 412)
  }

  return { job, attempt, question }
}

async function answerEdit(
  client: PoolClient,
  question: QuestionRow,
  input: ProcessingAnswerDto,
  subjectId: string,
  captureRevision: string,
): Promise<CaptureEditDto> {
  const inputs = await client.query('SELECT * FROM processing_input WHERE id=$1', [
    question.input_id,
  ])
  const retainedInput = inputs.rows[0]
  decodeProcessingInput(retainedInput.manifest_bytes, retainedInput.manifest_digest)
  const matchingInput =
    retainedInput.manifest_digest.toString('hex') === input.input_sha256 &&
    retainedInput.capture_revision === captureRevision
  if (!matchingInput) {
    fail('stale_question', 412)
  }

  const spec = await loadRetainedQuestionSpec(client, question.id, subjectId)
  validate('ProcessingQuestionSpec', spec)
  if (spec.kind !== input.value.kind || spec.subject_id !== subjectId) {
    fail('invalid_answer', 422)
  }

  if (input.value.kind === 'quantity') {
    return {
      expected_revision: input.expected_capture_revision,
      change: { kind: 'lot', id: subjectId, quantity: { mode: 'set', value: input.value.value } },
    }
  }

  return {
    expected_revision: input.expected_capture_revision,
    change: { kind: 'note', subject_id: subjectId, text: input.value.text },
  }
}

/** Human edit and fresh continuation are one caller-owned transaction, with events published last. */
export async function answerQuestion(
  pool: Pool,
  config: ProcessingConfig,
  lockCapture: LockCapture,
  batchId: string,
  questionId: string,
  key: string,
  input: ProcessingAnswerDto,
) {
  validate('ProcessingAnswer', input)
  channelToken(config, input.attempt_id)
  const scope = commandScope(config, 'processing_answer', `${batchId}:${questionId}`, key)

  return transaction(pool, async (client) => {
    await prepareMediaTransaction(client)
    return idempotent(client, scope, input, async () => {
      // Serialize different keys before inspecting a previous answer, including after lost COMMIT ACK.
      await captureInTransaction(client, config, batchId, true)
      const originalReceipt = await adoptRetainedAnswer(client, config, batchId, questionId, input)
      if (originalReceipt) {
        return originalReceipt
      }

      const capture = await lockCapture(client, config, batchId, input.expected_capture_revision)
      const affectedSubjects = await continuationSubjectIds(client, batchId, input.attempt_id)
      const media = await reserveProcessingMedia(client, config, capture.snapshot, affectedSubjects)
      const authority = await loadProcessingAuthority(client, config, input.attempt_id)
      const questionMedia = reservedMediaFor(media, authority.manifest.subject_id)
      const currentMedia = decodeMediaInputs(
        Buffer.from(questionMedia.manifest, 'utf8'),
        Buffer.from(questionMedia.manifestDigest, 'hex'),
      )
      const dependencyStatus = await processingDependencyStatus(client, config, authority)
      const questionCurrent =
        dependencyStatus.current &&
        dependencyStatus.ready &&
        processingInputIsCurrent(
          authority.manifest,
          capture.snapshot,
          currentMedia,
          config.approvedSourceUrls,
        )
      if (!questionCurrent) {
        fail('stale_question', 412)
      }
      await lockLane(client, config.actorId)
      const { job, attempt, question } = await lockCurrentQuestion(
        client,
        batchId,
        questionId,
        input,
      )
      const edit = await answerEdit(
        client,
        question,
        input,
        job.subject_id,
        capture.snapshot.revision,
      )
      const snapshot = await capture.apply(edit)

      const dependencyRows = await client.query<{ dependency_attempt_id: string }>(
        'SELECT dependency_attempt_id FROM processing_dependency WHERE attempt_id=$1 ORDER BY dependency_attempt_id',
        [attempt.id],
      )
      const dependencies = dependencyRows.rows.map((dependency) => dependency.dependency_attempt_id)
      const answerId = randomUUID()
      const attemptNumber = (BigInt(attempt.number) + 1n).toString()
      const continuation = await createAttempt(
        client,
        config,
        snapshot,
        job,
        attemptNumber,
        dependencies,
        reservedMediaFor(media, job.subject_id),
        attempt.input_id,
        answerId,
      )
      const value = sealed({ ...input, question_id: questionId })

      await client.query(
        `INSERT INTO processing_answer(id,job_id,question_id,actor_id,value_bytes,value_digest,continuation_attempt_id)
       VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [
          answerId,
          job.id,
          questionId,
          config.actorId,
          value.bytes,
          value.digest,
          continuation.attemptId,
        ],
      )
      await client.query(
        "UPDATE processing_question SET state='answered',revision=revision+1 WHERE id=$1",
        [questionId],
      )
      await client.query(
        "UPDATE processing_job SET current_attempt_id=$2,state='queued',revision=revision+1 WHERE id=$1",
        [job.id, continuation.attemptId],
      )

      await continueDependentJobs(
        client,
        config,
        snapshot,
        attempt.id,
        continuation.attemptId,
        answerId,
        media,
      )

      await capture.publish()
      await appendEvent(client, capture.streamId, 'processing_changed', { batch_id: batchId })
      return {
        answer_id: answerId,
        question_id: questionId,
        attempt_id: continuation.attemptId,
        capture_revision: snapshot.revision,
        command_id: continuation.commandId,
      }
    })
  })
}
