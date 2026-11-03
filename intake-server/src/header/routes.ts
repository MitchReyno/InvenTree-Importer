import type { FastifyInstance } from 'fastify'
import {
  schemas,
  type ConnectionStatusDto,
  type HeaderWorkDto,
  type HeaderWorkQueryDto,
} from '@invimport/contracts'
import type { DevConfig } from '../config.ts'
import { CaptureError, fail } from '../capture/repository.ts'
import { ProcessingError } from '../processing/model.ts'

export function registerHeader(
  app: FastifyInstance,
  config: DevConfig,
  connection: () => Promise<ConnectionStatusDto>,
  work: (batchId?: string) => Promise<HeaderWorkDto>,
) {
  app.register(async (scope) => {
    scope.setErrorHandler((error, request, reply) => {
      if (!(error instanceof CaptureError) && !(error instanceof ProcessingError)) {
        throw error
      }
      reply.code(error.statusCode).send({
        code: error.code,
        message: 'Header observation is unavailable.',
        recovery: 'none',
        correlation_id: request.id,
      })
    })
    scope.get(
      '/api/v1/connection-status',
      { schema: { response: { 200: schemas.ConnectionStatus } } },
      connection,
    )
    scope.get<{ Querystring: HeaderWorkQueryDto }>(
      '/api/v1/header-work',
      { schema: { querystring: schemas.HeaderWorkQuery, response: { 200: schemas.HeaderWork } } },
      (request) => {
        if (!config.apiKey?.trim() || config.credentialRef === 'unconfigured') {
          fail('setup_required', 503)
        }
        return work(request.query.batch_id)
      },
    )
  })
}
