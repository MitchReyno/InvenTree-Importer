import type { FastifyInstance, FastifyRequest } from 'fastify'
import {
  Id,
  schemas,
  type BatchRecordDto,
  type BatchRecordsDto,
  type RecordExistingValuesDto,
} from '@invimport/contracts'
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

/** A read model only: edits go through the capture edit route. */
export function registerRecords(
  app: FastifyInstance,
  config: DevConfig,
  read: (batchId: string) => Promise<BatchRecordsDto>,
  /** Absent where no target is configured; the route then says the values are unavailable. */
  existing?: {
    read: (records: readonly BatchRecordDto[]) => Promise<RecordExistingValuesDto>
    /** Refuses once the target context has rotated, before and after target traffic. */
    fence: () => Promise<void>
  },
) {
  const configured = bootstrap(config).status === 'configured'
  app.register(async (scope) => {
    scope.setErrorHandler((error, request, reply) => {
      if (!(error instanceof CaptureError) && !(error instanceof ProcessingError)) {
        throw error
      }
      reply.code(error.statusCode).send({
        code: error.code,
        message: 'Batch records are unavailable.',
        recovery: 'none',
        correlation_id: request.id,
      })
    })
    scope.get(
      '/api/v1/batches/:id/records',
      { schema: { response: { 200: schemas.BatchRecords } } },
      (request) => {
        const id = batchId(request)
        if (!configured) {
          fail('setup_required', 503)
        }
        return read(id)
      },
    )
    // Read only when Records asks, so opening Records never waits on the target.
    scope.get(
      '/api/v1/batches/:id/records/existing',
      { schema: { response: { 200: schemas.RecordExistingValues } } },
      async (request) => {
        const id = batchId(request)
        if (!configured) {
          fail('setup_required', 503)
        }
        if (!existing) {
          fail('target_unavailable', 503)
        }
        const records = (await read(id)).records
        await existing.fence()
        const result = await existing.read(records)
        await existing.fence()
        return result
      },
    )
  })
}
