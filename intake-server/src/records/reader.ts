import type { Pool } from 'pg'
import { lotLocationGroups, projectRecords, type BatchRecordsDto } from '@invimport/contracts'
import { transaction } from '../db/database.ts'
import { captureRepository } from '../capture/repository.ts'
import { type CaptureBinding } from '../capture/model.ts'
import { mediaSnapshot } from '../media/read.ts'
import type { ProcessingConfig } from '../processing/attempts.ts'
import type { LockCapture } from '../processing/capture.ts'
import { ProcessingError } from '../processing/model.ts'
import { processingRepository } from '../processing/repository.ts'

/**
 * Reads capture state, Processing (for each field's proposing step) and media (for group
 * locations). Processing that cannot be read leaves origins as the operator's, not a failure.
 */
export function recordsReader(
  pool: Pool,
  binding: CaptureBinding,
  processingConfig: ProcessingConfig | undefined,
  lockCapture: LockCapture,
  mediaEnabled: boolean,
) {
  const capture = captureRepository(pool, binding)
  const processing = processingConfig
    ? processingRepository(pool, processingConfig, lockCapture)
    : undefined

  return async (batchId: string): Promise<BatchRecordsDto> => {
    const snapshot = await capture.read(batchId)
    const [processingSnapshot, media] = await Promise.all([
      processing?.read(batchId).catch((error: unknown) => {
        if (error instanceof ProcessingError) {
          return undefined
        }
        throw error
      }),
      mediaEnabled
        ? transaction(pool, (client) => mediaSnapshot(client, binding, batchId))
        : undefined,
    ])
    return projectRecords({
      capture: snapshot,
      processing: processingSnapshot,
      lotGroups: media ? lotLocationGroups(media.evidence) : null,
    })
  }
}
