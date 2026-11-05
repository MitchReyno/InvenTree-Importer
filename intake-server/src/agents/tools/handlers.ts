import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { Pool, PoolClient } from 'pg'
import {
  validate,
  type ProcessingProposalV5Dto,
  type SessionAskArgsDto,
  type SessionToolErrorDto,
  type SessionToolResultDto,
} from '@invimport/contracts'
import { executeDatabaseQuery, queryDatabase, transaction } from '../../db/database.ts'
import { appendEvent } from '../../db/authority.ts'
import { captureBatches } from '../../capture/schema.ts'
import { lockCaptureForInputSettlement } from '../../capture/repository.ts'
import type { ProcessingConfig } from '../../processing/attempts.ts'
import { sealed } from '../../processing/model.ts'
import { deliveredSourceCheck } from '../../processing/provenance.ts'
import { lockProcessingAttempt } from '../../processing/state.ts'
import {
  processingAttempts,
  processingMessages,
  processingProposals,
  processingQuestions,
  processingJobs,
} from '../../processing/schema.ts'
import { decodeMediaInputs } from '../../media/inputs.ts'
import { mediaContent } from '../../media/content.ts'
import type { BlobStore } from '../../media/blob-store.ts'
import { sha256 } from '../../db/authority.ts'
import { resolveSessionCapability, type SessionPrincipal } from './capability.ts'
import { appendSessionOutbox, lastStatusAt } from './outbox.ts'
import { pendingSessionInbox, readSessionInbox, sessionInboxItem } from './inbox.ts'

export const SESSION_IMAGE_BUDGET_BYTES = 8 * 1024 * 1024
const SUPPORTED_IMAGES = new Set(['image/jpeg', 'image/png', 'image/webp'])

export interface SessionToolContext {
  pool: Pool
  config: ProcessingConfig
  store?: BlobStore
  statusIntervalMs: number
  /** Image bytes already returned in this provider run, by attempt. */
  imageBudget: Map<string, number>
}

export interface SessionToolOutput {
  result: SessionToolResultDto
  images?: { mediaType: string; base64: string }[]
}

class ToolRefusal extends Error {
  constructor(
    readonly code: SessionToolErrorDto,
    message: string,
  ) {
    super(message)
  }
}

const refuse = (code: SessionToolErrorDto, message: string): never => {
  throw new ToolRefusal(code, message)
}

function validated<T>(name: Parameters<typeof validate>[0], value: unknown): T {
  try {
    validate(name, value)
  } catch (error) {
    refuse(
      'validation_failed',
      `Arguments do not match ${name}: ${String((error as Error).message).slice(0, 400)}`,
    )
  }
  return value as T
}

async function batchStream(client: PoolClient, batchId: string) {
  const rows = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ streamId: captureBatches.streamId })
      .from(captureBatches)
      .where(eq(captureBatches.id, batchId)),
  )
  return rows[0].streamId
}

/**
 * Runs one tool call in its own transaction. The capability is resolved again inside it, so a
 * revoke or state change between the HTTP check and the write refuses the call with no change.
 */
async function withSession(
  context: SessionToolContext,
  token: string,
  work: (
    client: PoolClient,
    principal: SessionPrincipal,
  ) => Promise<SessionToolOutput['result'] | SessionToolOutput>,
): Promise<SessionToolOutput> {
  try {
    return await transaction(context.pool, async (client) => {
      const principal =
        (await resolveSessionCapability(client, token)) ??
        refuse('capability_refused', 'This session capability is not valid.')
      const output = await work(client, principal)
      return 'result' in output ? output : { result: output }
    })
  } catch (error) {
    if (!(error instanceof ToolRefusal)) {
      throw error
    }
    const pending = await transaction(context.pool, async (client) => {
      const principal = await resolveSessionCapability(client, token)
      return principal ? pendingSessionInbox(client, principal.lineageId!) : 0
    })
    return {
      result: { ok: false, error: error.code, message: error.message, pending_inbox: pending },
    }
  }
}

async function ok(client: PoolClient, principal: SessionPrincipal, extra: object = {}) {
  return {
    ok: true as const,
    pending_inbox: await pendingSessionInbox(client, principal.lineageId!),
    ...extra,
  }
}

/** Every citation must come from what this session was given. */
async function requireDeliveredSources(
  client: PoolClient,
  principal: SessionPrincipal,
  proposal: ProcessingProposalV5Dto,
) {
  const manifest = principal.manifest
  const delivered = deliveredSourceCheck({
    batchId: manifest.batch_id,
    notes: manifest.notes,
    media: manifest.media,
  })
  for (const source of proposal.sources) {
    if (!delivered(source)) {
      refuse('source_not_delivered', 'A cited source was not delivered to this session.')
    }
  }
  for (const source of proposal.relies_on.sources) {
    if (source.kind === 'note' || source.kind === 'media_version') {
      if (!delivered(source)) {
        refuse('source_not_delivered', 'A relied-on source was not delivered to this session.')
      }
    } else if (source.kind === 'inbox_item') {
      if (!(await sessionInboxItem(client, principal.lineageId!, source.inbox_item_id))) {
        refuse('source_not_delivered', 'A relied-on inbox item does not belong to this session.')
      }
    } else if (source.kind === 'proposal') {
      const rows = await executeDatabaseQuery(
        queryDatabase(client)
          .select({ batchId: processingJobs.batchId })
          .from(processingProposals)
          .innerJoin(processingAttempts, eq(processingAttempts.id, processingProposals.attemptId))
          .innerJoin(processingJobs, eq(processingJobs.id, processingAttempts.jobId))
          .where(eq(processingProposals.id, source.proposal_id)),
      )
      if (rows[0]?.batchId !== manifest.batch_id) {
        refuse('source_not_delivered', 'A relied-on proposal does not belong to this batch.')
      }
    } else {
      // Evidence observations and lot membership arrive with the lead session.
      refuse('source_not_delivered', 'Evidence observations are not available to this session.')
    }
  }
}

/** Retains a session proposal or question as an authenticated message, like runner envelopes. */
async function retainSessionMessage(
  client: PoolClient,
  context: SessionToolContext,
  principal: SessionPrincipal,
  kind: 'proposal' | 'question',
  payload: ProcessingProposalV5Dto | SessionAskArgsDto,
) {
  const capture = await lockCaptureForInputSettlement(client, context.config, principal.batchId)
  const { job, attempt } = await lockProcessingAttempt(client, principal.jobId, principal.attemptId)
  if (
    capture.snapshot.archived ||
    attempt.state !== 'running' ||
    job.current_attempt_id !== attempt.id
  ) {
    refuse('session_not_running', 'This session can no longer publish results.')
  }
  const sequence = BigInt(attempt.last_sequence) + 1n
  const envelope = sealed({
    schema_version: 'bench-intake-session/1',
    job_id: principal.jobId,
    attempt_id: principal.attemptId,
    command_id: principal.commandId,
    input_sha256: principal.inputDigest.toString('hex'),
    sequence: sequence.toString(),
    kind,
    payload,
  })
  validate('SessionEnvelope', JSON.parse(envelope.bytes.toString('utf8')))
  const messageId = randomUUID()
  const db = queryDatabase(client)
  await executeDatabaseQuery(
    db.insert(processingMessages).values({
      id: messageId,
      attemptId: attempt.id,
      sequence,
      envelopeBytes: envelope.bytes,
      envelopeDigest: envelope.digest,
      disposition: 'accepted',
    }),
  )
  await executeDatabaseQuery(
    db
      .update(processingAttempts)
      .set({ lastSequence: sequence })
      .where(eq(processingAttempts.id, attempt.id)),
  )
  return { messageId, streamId: capture.streamId }
}

export function sessionTools(context: SessionToolContext) {
  return {
    status: (token: string, args: unknown) =>
      withSession(context, token, async (client, principal) => {
        const { text } = validated<{ text: string }>('SessionStatusArgs', args)
        const last = await lastStatusAt(client, principal.attemptId)
        if (last && Date.now() - last.getTime() < context.statusIntervalMs) {
          refuse(
            'status_rate_limited',
            `Status lines are limited to one every ${Math.ceil(context.statusIntervalMs / 1000)} seconds.`,
          )
        }
        await appendSessionOutbox(client, principal.attemptId, {
          kind: 'status',
          payload: { text },
        })
        await appendEvent(client, await batchStream(client, principal.batchId), 'session_changed', {
          batch_id: principal.batchId,
        })
        return ok(client, principal)
      }),

    reply: (token: string, args: unknown) =>
      withSession(context, token, async (client, principal) => {
        const reply = validated<{ inbox_item_id: string; text: string }>('SessionReplyArgs', args)
        if (!(await sessionInboxItem(client, principal.lineageId!, reply.inbox_item_id))) {
          refuse('inbox_item_unknown', 'That inbox item does not belong to this session.')
        }
        await appendSessionOutbox(client, principal.attemptId, { kind: 'reply', payload: reply })
        await appendEvent(client, await batchStream(client, principal.batchId), 'session_changed', {
          batch_id: principal.batchId,
        })
        return ok(client, principal)
      }),

    read_inbox: (token: string, args: unknown) =>
      withSession(context, token, async (client, principal) => {
        const { after_seq } = validated<{ after_seq: string }>('SessionReadInboxArgs', args)
        const items = await readSessionInbox(client, principal.lineageId!, BigInt(after_seq))
        return ok(client, principal, { items })
      }),

    propose: (token: string, args: unknown) =>
      withSession(context, token, async (client, principal) => {
        const { proposal } = validated<{ proposal: ProcessingProposalV5Dto }>(
          'SessionProposeArgs',
          args,
        )
        if (principal.subjectId === null || proposal.subject_id !== principal.subjectId) {
          refuse('validation_failed', 'A proposal must be for this session’s lot.')
        }
        await requireDeliveredSources(client, principal, proposal)
        const { messageId, streamId } = await retainSessionMessage(
          client,
          context,
          principal,
          'proposal',
          proposal,
        )
        const value = sealed(proposal)
        const id = randomUUID()
        await executeDatabaseQuery(
          queryDatabase(client).insert(processingProposals).values({
            id,
            attemptId: principal.attemptId,
            messageId,
            valueBytes: value.bytes,
            valueDigest: value.digest,
            reliesOn: proposal.relies_on,
          }),
        )
        await appendSessionOutbox(client, principal.attemptId, {
          kind: 'proposal',
          payload: { proposal_id: id },
        })
        await appendEvent(client, streamId, 'processing_changed', { batch_id: principal.batchId })
        return ok(client, principal, { id })
      }),

    ask: (token: string, args: unknown) =>
      withSession(context, token, async (client, principal) => {
        const ask = validated<SessionAskArgsDto>('SessionAskArgs', args)
        if (principal.subjectId === null || ask.subject_id !== principal.subjectId) {
          refuse('validation_failed', 'A question must be about this session’s lot.')
        }
        const { messageId, streamId } = await retainSessionMessage(
          client,
          context,
          principal,
          'question',
          ask,
        )
        const spec = sealed(ask)
        const id = randomUUID()
        // Questions do not block: the attempt keeps running on the stated assumption.
        await executeDatabaseQuery(
          queryDatabase(client)
            .insert(processingQuestions)
            .values({
              id,
              batchId: principal.batchId,
              jobId: principal.jobId,
              attemptId: principal.attemptId,
              messageId,
              inputId: (
                await executeDatabaseQuery(
                  queryDatabase(client)
                    .select({ inputId: processingAttempts.inputId })
                    .from(processingAttempts)
                    .where(eq(processingAttempts.id, principal.attemptId)),
                )
              )[0].inputId,
              state: 'open',
              specBytes: spec.bytes,
              specDigest: spec.digest,
            }),
        )
        await appendSessionOutbox(client, principal.attemptId, {
          kind: 'question',
          payload: { question_id: id },
        })
        await appendEvent(client, streamId, 'processing_changed', { batch_id: principal.batchId })
        return ok(client, principal, { id })
      }),

    fetch_evidence: (token: string, args: unknown) =>
      withSession(context, token, async (client, principal) => {
        const request = validated<{
          evidence_id: string
          version_id?: string
          region?: unknown
          page?: number
        }>('SessionFetchEvidenceArgs', args)
        if (request.region !== undefined || request.page !== undefined) {
          refuse('validation_failed', 'Pages and region crops are not available to this session.')
        }
        const media = decodeMediaInputs(
          Buffer.from(principal.manifest.media.manifest, 'utf8'),
          Buffer.from(principal.manifest.media.sha256, 'hex'),
        )
        const version = media.versions.find(
          (item) =>
            item.evidenceId === request.evidence_id &&
            (request.version_id === undefined || item.versionId === request.version_id),
        )
        if (!version) {
          refuse('source_not_delivered', 'That evidence was not delivered to this session.')
        }
        const used = context.imageBudget.get(principal.attemptId) ?? 0
        const fits = BigInt(version!.byteSize) <= BigInt(SESSION_IMAGE_BUDGET_BYTES - used)
        if (!context.store || !SUPPORTED_IMAGES.has(version!.mediaType) || !fits) {
          return ok(client, principal, { id: version!.versionId })
        }
        const bytes = await mediaContent(context.pool, context.config, context.store).original(
          principal.batchId,
          version!.versionId,
        )
        if (
          bytes.length.toString() !== version!.byteSize ||
          sha256(bytes).toString('hex') !== version!.digest
        ) {
          throw new Error('agent_media_invalid')
        }
        context.imageBudget.set(principal.attemptId, used + bytes.length)
        return {
          result: await ok(client, principal, { id: version!.versionId }),
          images: [{ mediaType: version!.mediaType, base64: bytes.toString('base64') }],
        }
      }),
  }
}
