import type { Pool } from 'pg'
import type {
  ProcessingAnswerDto,
  ProcessingCancellationDto,
  ProcessingStartDto,
} from '@invimport/contracts'
import { transaction } from '#/db/database.ts'
import { captureInTransaction } from '#/capture/repository.ts'
import type { LockCapture } from './capture.ts'
import type { ProcessingConfig } from './attempts.ts'
import { startProcessing, cancelProcessing, answerQuestion } from './commands.ts'
import { processingActivity, processingSnapshot } from './read.ts'
import { prepareMediaTransaction } from '#/media/transaction.ts'

export function processingRepository(
  pool: Pool,
  config: ProcessingConfig,
  lockCapture: LockCapture,
) {
  return {
    start: (batchId: string, key: string, input: ProcessingStartDto) =>
      startProcessing(pool, config, batchId, key, input),

    cancel: (batchId: string, jobId: string, key: string, input: ProcessingCancellationDto) =>
      cancelProcessing(pool, config, batchId, jobId, key, input),

    answer: (batchId: string, questionId: string, key: string, input: ProcessingAnswerDto) =>
      answerQuestion(pool, config, lockCapture, batchId, questionId, key, input),

    async read(batchId: string) {
      return transaction(pool, async (client) => {
        await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
        await prepareMediaTransaction(client)
        const capture = await captureInTransaction(client, config, batchId)
        return processingSnapshot(client, config, capture.snapshot)
      })
    },

    async activity() {
      return transaction(pool, async (client) => {
        await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
        await prepareMediaTransaction(client)
        return processingActivity(client, config)
      })
    },
  }
}
