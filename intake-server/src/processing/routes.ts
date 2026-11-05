import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { Pool } from 'pg'
import {
  Id,
  schemas,
  type ProcessingStartDto,
  type ProcessingAnswerDto,
  type ProcessingCancellationDto,
  type SessionInboxSubmissionDto,
} from '@invimport/contracts'
import { submitSessionInbox } from '../agents/tools/inbox.ts'
import { readSessionTimeline } from '../agents/tools/timeline.ts'
import type { LockCapture } from './capture.ts'
import type { ProcessingConfig } from './attempts.ts'
import { processingRepository } from './repository.ts'
import { fail, ProcessingError } from './model.ts'
import { CaptureError } from '../capture/repository.ts'
import { CommandPayloadConflict } from '../db/authority.ts'

function id(request: FastifyRequest, field = 'id') {
  const value = (request.params as Record<string, string>)[field]
  if (!value || !new RegExp(Id.pattern!).test(value)) {
    fail('invalid_id', 400)
  }
  return value
}

function key(request: FastifyRequest) {
  const value = request.headers['idempotency-key']
  if (typeof value !== 'string' || !new RegExp(Id.pattern!).test(value)) {
    fail('idempotency_key_required', 400)
  }
  return value
}

/** Explicit protected browser routes; no runner channel, worker startup or inference. */
export function registerProcessing(
  app: FastifyInstance,
  pool: Pool,
  config: ProcessingConfig,
  lockCapture: LockCapture,
) {
  const repository = processingRepository(pool, config, lockCapture)
  app.register(async (scope) => {
    scope.setErrorHandler((error, request, reply) => {
      const conflict = error instanceof CommandPayloadConflict
      if (!(error instanceof ProcessingError) && !(error instanceof CaptureError) && !conflict) {
        throw error
      }
      const code = conflict ? 'payload_conflict' : (error as ProcessingError).code
      reply.code(conflict ? 409 : (error as ProcessingError).statusCode).send({
        code,
        message:
          code === 'stale_question'
            ? 'This question is no longer current. Your unsaved answer has been kept.'
            : 'Processing request could not be accepted.',
        recovery: ['stale_question', 'revision_conflict', 'stale_attempt'].includes(code)
          ? 'refresh'
          : 'none',
        correlation_id: request.id,
      })
    })
    scope.get(
      '/api/v1/processing-activity',
      { schema: { response: { 200: schemas.ProcessingActivity } } },
      () => repository.activity(),
    )
    scope.get(
      '/api/v1/batches/:id/processing',
      { schema: { response: { 200: schemas.ProcessingSnapshot } } },
      (request) => repository.read(id(request)),
    )
    scope.post<{ Body: ProcessingStartDto }>(
      '/api/v1/batches/:id/processing',
      { schema: { body: schemas.ProcessingStart, response: { 202: schemas.ProcessingReceipt } } },
      async (request, reply) =>
        reply.code(202).send(await repository.start(id(request), key(request), request.body)),
    )
    scope.post<{ Body: ProcessingCancellationDto }>(
      '/api/v1/batches/:id/processing/:jobId/cancellation',
      {
        schema: {
          body: schemas.ProcessingCancellation,
          response: { 200: schemas.ProcessingReceipt },
        },
      },
      (request) => repository.cancel(id(request), id(request, 'jobId'), key(request), request.body),
    )
    scope.post<{ Body: ProcessingAnswerDto }>(
      '/api/v1/batches/:id/questions/:questionId/answers',
      {
        schema: {
          body: schemas.ProcessingAnswer,
          response: { 200: schemas.ProcessingAnswerReceipt },
        },
      },
      (request) =>
        repository.answer(id(request), id(request, 'questionId'), key(request), request.body),
    )
    scope.get(
      '/api/v1/batches/:id/processing/:jobId/session',
      { schema: { response: { 200: schemas.SessionTimeline } } },
      (request) => readSessionTimeline(pool, config, id(request), id(request, 'jobId')),
    )
    scope.post<{ Body: SessionInboxSubmissionDto }>(
      '/api/v1/batches/:id/processing/:jobId/inbox',
      {
        schema: {
          body: schemas.SessionInboxSubmission,
          response: { 200: schemas.SessionInboxReceipt },
        },
      },
      (request) =>
        submitSessionInbox(pool, {
          batchId: id(request),
          lineageId: id(request, 'jobId'),
          actorId: config.actorId,
          idempotencyKey: `chat:${request.body.idempotency_key}`,
          kind: 'chat',
          payload: { text: request.body.text },
        }),
    )
  })
}
