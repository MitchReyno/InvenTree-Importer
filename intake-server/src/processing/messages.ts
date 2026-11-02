import { randomUUID, timingSafeEqual } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { and, eq } from 'drizzle-orm'
import { validate, type ProcessingEnvelopeDto } from '@invimport/contracts'
import { canonical } from '@invimport/contracts/json'
import { executeDatabaseQuery, queryDatabase, transaction } from '../db/database.ts'
import {
  processingAttempts,
  processingMessages,
  processingProposals,
  processingQuestions,
} from './schema.ts'
import { appendEvent, sha256, verifyBytes } from '../db/authority.ts'
import { lockCaptureForInputSettlement } from '../capture/repository.ts'
import { lockLane } from './scope.ts'
import type { ProcessingConfig } from './attempts.ts'
import { MAX_RUNNER_MESSAGE_BYTES } from './limits.ts'
import { fail, sealed } from './model.ts'
import { loadProcessingAuthority, processingInputIsCurrent } from './authority.ts'
import { lockProcessingAttempt, transitionAttempt, releaseProcessingLane } from './state.ts'
import { validateProposalSources } from './provenance.ts'
import { prepareMediaTransaction } from '../media/transaction.ts'
import { lockProcessingMediaCurrency } from './media.ts'
import { processingDependencyStatus } from './dependencies.ts'
import { verifyRetainedResearchSources } from './research-sources.ts'

type Authority = Awaited<ReturnType<typeof loadProcessingAuthority>>

function authenticateEnvelope(
  authority: Authority,
  token: string,
  envelope: ProcessingEnvelopeDto,
) {
  const tokenDigest = sha256(Buffer.from(canonical(token)))
  if (!timingSafeEqual(tokenDigest, authority.row.channelDigest)) {
    fail('runner_authentication_failed', 403)
  }

  const bindingMatches =
    envelope.job_id === authority.row.jobId &&
    envelope.command_id === authority.row.commandId &&
    envelope.input_sha256 === authority.row.manifestDigest.toString('hex') &&
    envelope.profile_id === authority.row.profileId &&
    envelope.handler_version === authority.row.handlerVersion

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
    validateProposalSources(authority.manifest, envelope.payload)
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
  const messages = await executeDatabaseQuery(
    queryDatabase(client)
      .select({
        envelopeBytes: processingMessages.envelopeBytes,
        envelopeDigest: processingMessages.envelopeDigest,
      })
      .from(processingMessages)
      .where(
        and(
          eq(processingMessages.attemptId, envelope.attempt_id),
          eq(processingMessages.sequence, BigInt(envelope.sequence)),
        ),
      ),
  )
  const priorMessage = messages[0]
  if (!priorMessage) {
    return false
  }

  verifyBytes(priorMessage.envelopeBytes, priorMessage.envelopeDigest)
  if (!priorMessage.envelopeBytes.equals(bytes)) {
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
    await executeDatabaseQuery(
      queryDatabase(client).insert(processingProposals).values({
        id: randomUUID(),
        attemptId: authority.row.id,
        messageId,
        valueBytes: proposal.bytes,
        valueDigest: proposal.digest,
      }),
    )
    return
  }

  if (envelope.kind === 'question') {
    const spec = sealed(envelope.payload)
    await executeDatabaseQuery(
      queryDatabase(client).insert(processingQuestions).values({
        id: randomUUID(),
        batchId: authority.row.batchId,
        jobId: authority.row.jobId,
        attemptId: authority.row.id,
        messageId,
        inputId: authority.row.inputId,
        state: 'open',
        specBytes: spec.bytes,
        specDigest: spec.digest,
      }),
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
    await prepareMediaTransaction(client)
    const authority = await loadProcessingAuthority(client, config, envelope.attempt_id)
    authenticateEnvelope(authority, token, envelope)

    const capture = await lockCaptureForInputSettlement(client, config, authority.row.batchId)
    const media = await lockProcessingMediaCurrency(
      client,
      config,
      capture.snapshot,
      authority.manifest.subject_id,
    )
    await lockLane(client, config.actorId)
    const { job, attempt } = await lockProcessingAttempt(
      client,
      authority.row.jobId,
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
    if (envelope.kind === 'proposal') {
      await verifyRetainedResearchSources(
        client,
        config,
        authority.manifest,
        {
          attemptId: authority.row.id,
          commandId: authority.row.commandId,
          inputSha256: authority.row.manifestDigest.toString('hex'),
        },
        envelope.payload,
      )
    }
    const dependencies = await processingDependencyStatus(client, config, authority)
    const stale =
      job.current_attempt_id !== attempt.id ||
      attempt.state !== 'running' ||
      capture.snapshot.archived ||
      !dependencies.current ||
      !dependencies.ready ||
      !media.available ||
      !processingInputIsCurrent(
        authority.manifest,
        capture.snapshot,
        media.inputs,
        config.approvedSourceUrls,
      )

    const messageId = randomUUID()
    await executeDatabaseQuery(
      queryDatabase(client)
        .insert(processingMessages)
        .values({
          id: messageId,
          attemptId: attempt.id,
          sequence: BigInt(envelope.sequence),
          envelopeBytes: retainedMessage.bytes,
          envelopeDigest: retainedMessage.digest,
          disposition: stale ? 'stale' : 'accepted',
        }),
    )
    await executeDatabaseQuery(
      queryDatabase(client)
        .update(processingAttempts)
        .set({ lastSequence: BigInt(envelope.sequence) })
        .where(eq(processingAttempts.id, attempt.id)),
    )

    if (stale) {
      // Authenticated stale bytes remain inspectable without creating a current proposal or question.
      // A proposal does not prove that the physical command ended or released its account lane.
      const commandEnded = envelope.kind === 'terminal' || envelope.kind === 'question'
      if (commandEnded) {
        if (attempt.state === 'running') {
          await transitionAttempt(client, job, attempt, 'superseded')
        } else {
          await releaseProcessingLane(client, attempt.id)
        }
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
