import type { FastifyInstance } from 'fastify'
import { schemas, type BatchAttentionDto } from '@invimport/contracts'
import { readModelError } from '../api/errors.ts'
import { pathId } from '../api/request.ts'
import { bootstrap, type DevConfig } from '../config.ts'
import { fail } from '../capture/model.ts'

/** A read model only: it never grants command authority. */
export function registerAttention(
  app: FastifyInstance,
  config: DevConfig,
  read: (batchId: string) => Promise<BatchAttentionDto>,
) {
  const configured = bootstrap(config).status === 'configured'
  app.register(async (scope) => {
    scope.setErrorHandler(readModelError('Batch attention is unavailable.'))
    scope.get(
      '/api/v1/batches/:id/attention',
      { schema: { response: { 200: schemas.BatchAttention } } },
      (request) => {
        const id = pathId(request)
        if (!configured) {
          fail('setup_required', 503)
        }
        return read(id)
      },
    )
  })
}
