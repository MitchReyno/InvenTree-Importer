import { randomUUID, timingSafeEqual } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { validate, type ProcessingEnvelopeDto } from '@invimport/contracts'
import { canonical } from '@invimport/contracts/json'
import { transaction } from '../db/database.ts'
import { appendEvent, sha256, verifyBytes } from '../db/authority.ts'
import { captureInTransaction } from '../capture/repository.ts'
import { lockLane } from './scope.ts'
import type { ProcessingConfig } from './attempts.ts'
import { MAX_RUNNER_MESSAGE_BYTES } from './limits.ts'
import { fail, sealed } from './model.ts'
import { loadProcessingAuthority, processingInputIsCurrent } from './authority.ts'
import { lockProcessingAttempt, transitionAttempt } from './state.ts'

type Authority = Awaited<ReturnType<typeof loadProcessingAuthority>>

function authenticateEnvelope(
  authority: Authority,
  token: string,
  envelope: ProcessingEnvelopeDto,
) {
  const tokenDigest = sha256(Buffer.from(canonical(token)))
  if (!timingSafeEqual(tokenDigest, authority.row.channel_digest)) {
    fail('runner_authentication_failed', 403)
  }

  const bindingMatches =
    envelope.job_id === authority.row.job_id &&
    envelope.command_id === authority.row.command_id &&
    envelope.input_sha256 === authority.row.manifest_digest.toString('hex') &&
    envelope.profile_id === authority.row.profile_id &&
    envelope.handler_version === authority.row.handler_version

  if (!bindingMatches) {
    fail('runner_binding_mismatch', 422)
  }
}

function validatePayloadReferences(
  authority: Authority,
  subjectId: string,
  envelope: ProcessingEnvelopeDto,
) {
  if (envelope.kind === 'terminal') {
    return
  }

  if (envelope.payload.subject_id !== subjectId) {
    fail('runner_subject_mismatch', 422)
  }

  if (envelope.kind === 'proposal') {
    const stagedNoteIds = new Set(authority.manifest.notes.map((note) => note.id))
    const unstagedSource = envelope.payload.source_note_ids.some((id) => !stagedNoteIds.has(id))
    if (unstagedSource) {
      fail('runner_source_mismatch', 422)
    }
  }

  const quantityQuestion = envelope.kind === 'question' && envelope.payload.kind === 'quantity'
  if (quantityQuestion && !('quantity' in authority.manifest.subject)) {
    fail('invalid_question', 422)
  }
}

async function messageAlreadyRetained(
  client: PoolClient,
  envelope: ProcessingEnvelopeDto,
  bytes: Buffer,
) {
  const messages = await client.query<{
    envelope_bytes: Buffer
    envelope_digest: Buffer
  }>(
    'SELECT envelope_bytes,envelope_digest FROM processing_message WHERE attempt_id=$1 AND sequence=$2',
    [envelope.attempt_id, envelope.sequence],
  )
  const priorMessage = messages.rows[0]
  if (!priorMessage) {
    return false
  }

  verifyBytes(priorMessage.envelope_bytes, priorMessage.envelope_digest)
  if (!priorMessage.envelope_bytes.equals(bytes)) {
    fail('payload_conflict')
  }

  return true
}

async function retainAcceptedPayload(
  client: PoolClient,
  authority: Authority,
  messageId: string,
  envelope: ProcessingEnvelopeDto,
) {
  if (envelope.kind === 'proposal') {
    const proposal = sealed(envelope.payload)
    await client.query('INSERT INTO processing_proposal VALUES($1,$2,$3,$4,$5)', [
      randomUUID(),
      authority.row.id,
      messageId,
      proposal.bytes,
      proposal.digest,
    ])
    return
  }

  if (envelope.kind === 'question') {
    const spec = sealed(envelope.payload)
    await client.query(
      `INSERT INTO processing_question(
         id,batch_id,job_id,attempt_id,message_id,input_id,state,spec_bytes,spec_digest)
       VALUES($1,$2,$3,$4,$5,$6,'open',$7,$8)`,
      [
        randomUUID(),
        authority.row.batch_id,
        authority.row.job_id,
        authority.row.id,
        messageId,
        authority.row.input_id,
        spec.bytes,
        spec.digest,
      ],
    )
  }
}

/** Envelope body is never authentication. Caller supplies an independently held private capability. */
export async function acceptEnvelope(
  pool: Pool,
  config: ProcessingConfig,
  token: string,
  envelope: ProcessingEnvelopeDto,
): Promise<'accepted' | 'stale' | 'duplicate'> {
  validate('ProcessingEnvelope', envelope)
  const retainedMessage = sealed(envelope)
  if (retainedMessage.bytes.length > MAX_RUNNER_MESSAGE_BYTES) {
    fail('runner_message_capacity', 422)
  }

  return transaction(pool, async (client) => {
    const authority = await loadProcessingAuthority(client, config, envelope.attempt_id)
    authenticateEnvelope(authority, token, envelope)

    const capture = await captureInTransaction(client, config, authority.row.batch_id, true)
    await lockLane(client, config.actorId)
    const { job, attempt } = await lockProcessingAttempt(
      client,
      authority.row.job_id,
      authority.row.id,
    )

    if (await messageAlreadyRetained(client, envelope, retainedMessage.bytes)) {
      return 'duplicate'
    }

    const expectedSequence = BigInt(attempt.last_sequence) + 1n
    if (BigInt(envelope.sequence) !== expectedSequence) {
      fail('runner_sequence_conflict')
    }

    validatePayloadReferences(authority, job.subject_id, envelope)
    const stale =
      job.current_attempt_id !== attempt.id ||
      attempt.state !== 'running' ||
      capture.snapshot.archived ||
      !processingInputIsCurrent(authority.manifest, capture.snapshot)

    const messageId = randomUUID()
    await client.query('INSERT INTO processing_message VALUES($1,$2,$3,$4,$5,$6)', [
      messageId,
      attempt.id,
      envelope.sequence,
      retainedMessage.bytes,
      retainedMessage.digest,
      stale ? 'stale' : 'accepted',
    ])
    await client.query('UPDATE processing_attempt SET last_sequence=$2 WHERE id=$1', [
      attempt.id,
      envelope.sequence,
    ])

    if (stale) {
      // Authenticated stale bytes remain inspectable without creating a current proposal or question.
      if (attempt.state === 'running') {
        await transitionAttempt(client, job, attempt, 'superseded')
        await appendEvent(client, capture.streamId, 'processing_changed', {
          batch_id: job.batch_id,
        })
      }
      return 'stale'
    }

    await retainAcceptedPayload(client, authority, messageId, envelope)
    if (envelope.kind !== 'proposal') {
      const nextState = envelope.kind === 'question' ? 'waiting_for_user' : envelope.payload.state
      await transitionAttempt(client, job, attempt, nextState)
    }

    await appendEvent(client, capture.streamId, 'processing_changed', { batch_id: job.batch_id })
    return 'accepted'
  })
}
