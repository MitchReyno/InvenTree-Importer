import type { FastifyInstance, FastifyRequest } from 'fastify'
import { Id, schemas, type BatchAttentionDto } from '@invimport/contracts'
import { bootstrap, type DevConfig } from '../config.ts'
import { CaptureError, fail } from '../capture/repository.ts'
import { ProcessingError } from '../processing/model.ts'

const ID_PATTERN = new RegExp(Id.pattern!)

function batchId(request: FastifyRequest) {
  const id = (request.params as { id: string }).id
  if (!ID_PATTERN.test(id)) {
    fail('invalid_id', 400)
  }
  return id
}

/** A read model only: it never grants command authority. */
export function registerAttention(
  app: FastifyInstance,
  config: DevConfig,
  read: (batchId: string) => Promise<BatchAttentionDto>,
) {
  const configured = bootstrap(config).status === 'configured'
  app.register(async (scope) => {
    scope.setErrorHandler((error, request, reply) => {
      if (!(error instanceof CaptureError) && !(error instanceof ProcessingError)) {
        throw error
      }
      reply.code(error.statusCode).send({
        code: error.code,
        message: 'Batch attention is unavailable.',
        recovery: 'none',
        correlation_id: request.id,
      })
    })
    scope.get(
      '/api/v1/batches/:id/attention',
      { schema: { response: { 200: schemas.BatchAttention } } },
      (request) => {
        const id = batchId(request)
        if (!configured) {
          fail('setup_required', 503)
        }
        return read(id)
      },
    )
  })
}
