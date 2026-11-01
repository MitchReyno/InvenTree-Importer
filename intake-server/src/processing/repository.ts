import type { Pool } from 'pg'
import {
  validate,
  type ProcessingSnapshotDto,
  type ProcessingStartDto,
  type ProcessingCancellationDto,
  type ProcessingAnswerDto,
} from '@invimport/contracts'
import { canonical } from '@invimport/contracts/json'
import { transaction } from '../db/database.ts'
import { captureInTransaction } from '../capture/repository.ts'
import type { LockCapture } from './capture.ts'
import type { ProcessingConfig } from './attempts.ts'
import { startProcessing, cancelProcessing, answerQuestion } from './commands.ts'
import { fail, decodeProcessingInput } from './model.ts'
import { retainedQuestionSpec, retainedProposalValue } from './retained.ts'
import {
  MAX_PROCESSING_SNAPSHOT_BYTES,
  MAX_JOB_RESULTS,
  MIN_CHANNEL_SECRET_BYTES,
} from './limits.ts'
import { processingInputIsCurrent } from './authority.ts'

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
    async read(batchId: string): Promise<ProcessingSnapshotDto> {
      return transaction(pool, async (client) => {
        await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
        const capture = await captureInTransaction(client, config, batchId)
        const rows = await client.query(
          `SELECT j.*,a.number,a.input_id,i.manifest_bytes,i.manifest_digest
          FROM processing_job j JOIN processing_attempt a ON a.id=j.current_attempt_id
          JOIN processing_input i ON i.id=a.input_id WHERE j.batch_id=$1 ORDER BY j.subject_id,j.stage`,
          [batchId],
        )
        const jobs: ProcessingSnapshotDto['jobs'] = []
        for (const row of rows.rows) {
          const manifest = decodeProcessingInput(row.manifest_bytes, row.manifest_digest)
          const dependencyCurrent = processingInputIsCurrent(manifest, capture.snapshot)
          const proposalRows = await client.query(
            `SELECT proposal.*,attempt.job_id,attempt.command_id,input.manifest_digest,
               message.envelope_bytes,message.envelope_digest,message.disposition
             FROM processing_proposal proposal
             JOIN processing_attempt attempt ON attempt.id=proposal.attempt_id
             JOIN processing_input input ON input.id=attempt.input_id
             JOIN processing_message message ON message.id=proposal.message_id
             WHERE proposal.attempt_id=$1 ORDER BY proposal.id LIMIT 101`,
            [row.current_attempt_id],
          )
          const questionRows = await client.query(
            `SELECT question.*,input.manifest_digest,attempt.command_id,
               message.envelope_bytes,message.envelope_digest,message.disposition
             FROM processing_question question
             JOIN processing_input input ON input.id=question.input_id
             JOIN processing_attempt attempt ON attempt.id=question.attempt_id
             JOIN processing_message message ON message.id=question.message_id
             WHERE question.job_id=$1 ORDER BY question.id LIMIT 101`,
            [row.id],
          )
          if (
            proposalRows.rows.length > MAX_JOB_RESULTS ||
            questionRows.rows.length > MAX_JOB_RESULTS
          ) {
            fail('processing_capacity')
          }
          jobs.push({
            id: row.id,
            subject_id: row.subject_id,
            stage: row.stage,
            revision: row.revision,
            state: dependencyCurrent ? row.state : 'superseded',
            attempt_id: row.current_attempt_id,
            input_sha256: row.manifest_digest.toString('hex'),
            attempt_number: row.number,
            qualification: 'fixture_only',
            proposals: proposalRows.rows.map((proposal) => ({
              id: proposal.id,
              message_id: proposal.message_id,
              value: retainedProposalValue(proposal, row.subject_id),
            })),
            questions: questionRows.rows.map((question) => ({
              id: question.id,
              job_id: question.job_id,
              attempt_id: question.attempt_id,
              input_sha256: question.manifest_digest.toString('hex'),
              revision: question.revision,
              state:
                !dependencyCurrent && question.state === 'open' ? 'superseded' : question.state,
              spec: retainedQuestionSpec(question, row.subject_id),
            })),
          })
        }
        const result: ProcessingSnapshotDto = {
          runner_status:
            Buffer.byteLength(config.channelSecret) >= MIN_CHANNEL_SECRET_BYTES
              ? 'fixture_only'
              : 'unconfigured',
          batch_id: batchId,
          capture_revision: capture.snapshot.revision,
          jobs,
          cursor: capture.snapshot.cursor,
        }
        validate('ProcessingSnapshot', result)
        if (Buffer.byteLength(canonical(result)) > MAX_PROCESSING_SNAPSHOT_BYTES) {
          fail('processing_capacity')
        }
        return result
      })
    },
    async activity() {
      const rows = await pool.query(
        `SELECT j.batch_id,j.id AS job_id,j.state FROM processing_job j
        JOIN command c ON c.id=(SELECT command_id FROM processing_attempt WHERE id=j.current_attempt_id)
        WHERE c.actor_id=$1 AND c.target_id=$2 AND c.target_context_id=$3
          AND j.state IN ('queued','running','waiting_for_user','waiting_for_login','waiting_for_capacity','interrupted')
        ORDER BY j.batch_id,j.id LIMIT 101`,
        [config.actorId, config.targetId, config.targetContextId],
      )
      return { jobs: rows.rows.slice(0, 100), truncated: rows.rows.length > 100 }
    },
  }
}
