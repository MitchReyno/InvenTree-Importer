import type { Pool } from 'pg'
import type { BatchAttentionDto, BatchRecordsDto } from '@invimport/contracts'
import { operatorRepository } from '#/operator-review/repository.ts'
import type { ProcessingConfig } from '#/processing/attempts.ts'
import type { LockCapture } from '#/processing/capture.ts'
import { processingRepository } from '#/processing/repository.ts'
import { manualRepository } from '#/review/repository.ts'
import type { ManualConfig } from '#/review/authority.ts'
import { projectAttention } from './projection.ts'

/**
 * Reads the same processing, review, manual and records projections the batch screens use. Each is its
 * own snapshot; the client refetches when the batch revision moves, so a mixed read is brief.
 */
export function attentionReader(
  pool: Pool,
  manualConfig: ManualConfig,
  processingConfig: ProcessingConfig,
  lockCapture: LockCapture,
  readRecords: (batchId: string) => Promise<BatchRecordsDto>,
) {
  const processing = processingRepository(pool, processingConfig, lockCapture)
  const review = operatorRepository(pool, manualConfig)
  const manual = manualRepository(pool, manualConfig)

  return async (batchId: string): Promise<BatchAttentionDto> => {
    const [processingSnapshot, operatorReview, workspace, records] = await Promise.all([
      processing.read(batchId),
      review.read(batchId),
      manual.workspace(batchId),
      readRecords(batchId),
    ])

    return projectAttention({
      batchId,
      processing: processingSnapshot,
      review: operatorReview,
      manual: workspace,
      records,
    })
  }
}
