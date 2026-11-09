import type { FastifyInstance } from 'fastify'
import {
  schemas,
  type BatchRecordDto,
  type BatchRecordsDto,
  type RecordExistingValuesDto,
} from '@invimport/contracts'
import { readModelError } from '../api/errors.ts'
import { pathId } from '../api/request.ts'
import { bootstrap, type DevConfig } from '../config.ts'
import { fail } from '../capture/repository.ts'

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
    scope.setErrorHandler(readModelError('Batch records are unavailable.'))
    scope.get(
      '/api/v1/batches/:id/records',
      { schema: { response: { 200: schemas.BatchRecords } } },
      (request) => {
        const id = pathId(request)
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
        const id = pathId(request)
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
