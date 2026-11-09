import type { Pool } from 'pg'
import { validate, type SessionReplacementDto } from '@invimport/contracts'
import { transaction } from '../db/database.ts'
import { appendEvent, idempotent } from '../db/authority.ts'
import { lockCaptureForInputs } from '../capture/repository.ts'
import { prepareMediaTransaction } from '../media/transaction.ts'
import { lockBatchMediaInputs } from '../media/locked-inputs.ts'
import type { ProcessingConfig } from './attempts.ts'
import { reserveProcessingMedia, reservedMediaFor } from './media.ts'
import { commandScope, lockLane } from './scope.ts'
import { fail } from './model.ts'
import { isSessionProfile } from './session-policy.ts'
import { createSessionAttempt } from './session-attempts.ts'
import { decodeSessionInput } from './session-input.ts'
import { pinnedIdentityCurrent, successorsCurrent } from './stable-identity.ts'
import { supersedeJobAttempts } from './supersede.ts'
import { instructNewSession } from '../agents/instructions.ts'

const REPLACEABLE_STATES = new Set([
  'cancelled',
  'failed',
  'interrupted',
  'resume_unavailable',
  'waiting_for_login',
])

/** Explicit replacement retains the lineage, inbox cursor and historical attempt effects. */
export async function replaceSession(
  pool: Pool,
  config: ProcessingConfig,
  batchId: string,
  jobId: string,
  key: string,
  input: SessionReplacementDto,
) {
  validate('SessionReplacement', input)
  const profileId = config.profileId
  if (!profileId || !isSessionProfile(profileId)) {
    fail('unsupported_processing_profile', 422)
  }
  return transaction(pool, async (client) => {
    await prepareMediaTransaction(client)
    return idempotent(
      client,
      commandScope(config, 'session_replace', `${batchId}:${jobId}`, key),
      input,
      async () => {
        const capture = await lockCaptureForInputs(
          client,
          config,
          batchId,
          input.expected_capture_revision,
        )
        const found = await client.query<{
          subject_id: string | null
          stage: 'examine' | 'research' | 'images' | 'inventory'
        }>('SELECT subject_id,stage FROM processing_job WHERE id=$1 AND batch_id=$2', [
          jobId,
          batchId,
        ])
        const job = found.rows[0] ?? fail('not_found', 404)
        if (
          job.subject_id &&
          capture.snapshot.lots.some((lot) => lot.id === job.subject_id && lot.retired)
        ) {
          fail('subject_retired', 409)
        }
        const lead = job.stage === 'examine' && job.subject_id === null
        const media = lead
          ? await lockBatchMediaInputs(client, config, batchId)
          : reservedMediaFor(
              await reserveProcessingMedia(client, config, capture.snapshot, [job.subject_id!]),
              job.subject_id!,
            )
        await lockLane(client, config.actorId)
        const current = await client.query<{
          revision: string
          current_attempt_id: string
          number: string
          input_id: string
          session_state: string
        }>(
          `SELECT j.revision,j.current_attempt_id,a.number,a.input_id,s.session_state
         FROM processing_job j JOIN processing_attempt a ON a.id=j.current_attempt_id
         JOIN agent_session s ON s.attempt_id=a.id
         WHERE j.id=$1 AND j.batch_id=$2 FOR UPDATE OF j,a`,
          [jobId, batchId],
        )
        const prior = current.rows[0] ?? fail('not_found', 404)
        if (
          prior.revision !== input.expected_revision ||
          prior.current_attempt_id !== input.attempt_id
        ) {
          fail('stale_attempt', 412)
        }
        if (!REPLACEABLE_STATES.has(prior.session_state)) {
          fail('session_not_replaceable', 409)
        }
        const held = await client.query(
          'SELECT 1 FROM agent_slot s JOIN processing_attempt a ON a.id=s.attempt_id WHERE a.job_id=$1',
          [jobId],
        )
        if (held.rowCount) {
          fail('session_reap_pending', 409)
        }
        if (
          job.stage === 'inventory' &&
          !(await successorsCurrent(client, batchId, job.subject_id!))
        ) {
          fail('inventory_waiting', 409)
        }
        const inputs = await client.query<{ manifest_bytes: Buffer; manifest_digest: Buffer }>(
          'SELECT manifest_bytes,manifest_digest FROM processing_input WHERE id=$1',
          [prior.input_id],
        )
        const inputRow = inputs.rows[0] ?? fail('processing_input_missing', 409)
        const pinned = decodeSessionInput(
          inputRow.manifest_bytes,
          inputRow.manifest_digest,
        ).pinned_proposal_ids
        if (!(await pinnedIdentityCurrent(client, pinned))) {
          fail('identity_waiting', 409)
        }
        await supersedeJobAttempts(client, jobId)
        const attempt = await createSessionAttempt(
          client,
          config,
          profileId,
          capture.snapshot,
          { id: jobId, ...job },
          (BigInt(prior.number) + 1n).toString(),
          media,
          prior.input_id,
          { pinnedProposalIds: pinned },
        )
        await client.query(
          "UPDATE processing_job SET current_attempt_id=$2,state='queued',revision=revision+1 WHERE id=$1",
          [jobId, attempt.attemptId],
        )
        // The replacement starts a new conversation, so it needs the instructions again.
        await instructNewSession(client, config, batchId, jobId, attempt.attemptId)
        await appendEvent(client, capture.streamId, 'processing_changed', { batch_id: batchId })
        return { batch_id: batchId, job_ids: [jobId], attempt_ids: [attempt.attemptId] }
      },
    )
  })
}
