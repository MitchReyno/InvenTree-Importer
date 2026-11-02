import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Pool } from 'pg'
import {
  Id,
  schemas,
  type BulkEditDto,
  type InstructionEditDto,
  type IssueDispositionDto,
  type RestructureDto,
} from '@invimport/contracts'
import { CommandPayloadConflict } from '../db/authority.ts'
import { CaptureError, fail } from '../capture/repository.ts'
import type { ManualConfig } from '../review/authority.ts'
import { operatorRepository } from './repository.ts'

const ID_PATTERN = new RegExp(Id.pattern!)

function batchId(request: FastifyRequest) {
  const id = (request.params as { id: string }).id
  if (!ID_PATTERN.test(id)) {
    fail('invalid_id', 400)
  }
  return id
}

function commandKey(request: FastifyRequest) {
  const key = request.headers['idempotency-key']
  if (typeof key !== 'string' || !ID_PATTERN.test(key)) {
    fail('idempotency_key_required', 400)
  }
  return key
}

function safeError(error: unknown, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof CommandPayloadConflict) {
    return reply.code(409).send({
      code: 'payload_conflict',
      message: 'This request key was already used for a different command.',
      recovery: 'none',
      correlation_id: request.id,
    })
  }
  if (!(error instanceof CaptureError)) {
    throw error
  }
  const conflict = error.code === 'revision_conflict'
  return reply.code(error.statusCode).send({
    code: error.code,
    message: conflict
      ? 'Another client saved first. Your unsaved input has not been applied.'
      : 'This review command could not be accepted; inspect the current review state.',
    recovery: conflict ? 'refresh' : 'review',
    correlation_id: request.id,
  })
}

/** Operator review routes share the manual scope's setup guard; no target writes happen here. */
export function registerOperatorReview(app: FastifyInstance, pool: Pool, config: ManualConfig) {
  const repository = operatorRepository(pool, config)
  app.register(async (scope) => {
    scope.addHook('preHandler', async () => {
      if (!config.apiKey?.trim() || config.credentialRef === 'unconfigured') {
        fail('setup_required', 503)
      }
    })
    scope.setErrorHandler(safeError)

    scope.get(
      '/api/v1/batches/:id/operator-review',
      { schema: { response: { 200: schemas.OperatorReview } } },
      (request) => repository.read(batchId(request)),
    )

    scope.post<{ Body: IssueDispositionDto }>(
      '/api/v1/batches/:id/issue-dispositions',
      { schema: { body: schemas.IssueDisposition, response: { 200: schemas.OperatorReview } } },
      (request) => repository.dismiss(batchId(request), commandKey(request), request.body),
    )

    scope.post<{ Body: BulkEditDto }>(
      '/api/v1/batches/:id/bulk-edits',
      { schema: { body: schemas.BulkEdit, response: { 200: schemas.BulkEditResult } } },
      (request) => repository.bulkEdit(batchId(request), commandKey(request), request.body),
    )

    scope.post<{ Body: RestructureDto }>(
      '/api/v1/batches/:id/restructures',
      { schema: { body: schemas.Restructure, response: { 200: schemas.RestructureResult } } },
      (request) => repository.restructure(batchId(request), commandKey(request), request.body),
    )

    scope.post<{ Body: InstructionEditDto }>(
      '/api/v1/batches/:id/instructions',
      { schema: { body: schemas.InstructionEdit, response: { 200: schemas.OperatorReview } } },
      (request) => repository.instruct(batchId(request), commandKey(request), request.body),
    )
  })
}
