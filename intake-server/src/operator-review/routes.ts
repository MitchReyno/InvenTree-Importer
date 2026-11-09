import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Pool } from 'pg'
import {
  schemas,
  type BulkEditDto,
  type InstructionEditDto,
  type IssueDispositionDto,
  type RestructureDto,
} from '@invimport/contracts'
import { pathId, commandKey } from '../api/request.ts'
import { bootstrap } from '../config.ts'
import { CommandPayloadConflict } from '../db/authority.ts'
import { CaptureError, fail } from '../capture/repository.ts'
import type { ManualConfig } from '../review/authority.ts'
import { operatorRepository } from './repository.ts'

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
  const configured = bootstrap(config).status === 'configured'
  app.register(async (scope) => {
    scope.addHook('preHandler', async () => {
      if (!configured) {
        fail('setup_required', 503)
      }
    })
    scope.setErrorHandler(safeError)

    scope.get(
      '/api/v1/batches/:id/operator-review',
      { schema: { response: { 200: schemas.OperatorReview } } },
      (request) => repository.read(pathId(request)),
    )

    scope.post<{ Body: IssueDispositionDto }>(
      '/api/v1/batches/:id/issue-dispositions',
      { schema: { body: schemas.IssueDisposition, response: { 200: schemas.OperatorReview } } },
      (request) => repository.dismiss(pathId(request), commandKey(request), request.body),
    )

    scope.post<{ Body: BulkEditDto }>(
      '/api/v1/batches/:id/bulk-edits',
      { schema: { body: schemas.BulkEdit, response: { 200: schemas.BulkEditResult } } },
      (request) => repository.bulkEdit(pathId(request), commandKey(request), request.body),
    )

    scope.post<{ Body: RestructureDto }>(
      '/api/v1/batches/:id/restructures',
      { schema: { body: schemas.Restructure, response: { 200: schemas.RestructureResult } } },
      (request) => repository.restructure(pathId(request), commandKey(request), request.body),
    )

    scope.post<{ Body: InstructionEditDto }>(
      '/api/v1/batches/:id/instructions',
      { schema: { body: schemas.InstructionEdit, response: { 200: schemas.OperatorReview } } },
      (request) => repository.instruct(pathId(request), commandKey(request), request.body),
    )
  })
}
