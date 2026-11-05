import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import type { Pool, PoolClient } from 'pg'
import {
  validate,
  type ProcessingProposalV5Dto,
  type ProcessingSourceDto,
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
import { catalogueSources, deliveredSourceCheck } from '../../processing/provenance.ts'
import { lockProcessingAttempt } from '../../processing/state.ts'
import {
  processingAttempts,
  processingMessages,
  processingProposals,
  processingQuestions,
} from '../../processing/schema.ts'
import { decodeMediaInputs } from '../../media/inputs.ts'
import { mediaContent } from '../../media/content.ts'
import type { BlobStore } from '../../media/blob-store.ts'
import { sha256 } from '../../db/authority.ts'
import { capabilityDigest, resolveSessionCapability, type SessionPrincipal } from './capability.ts'
import { agentSessionOutbox, agentSessions } from '../schema.ts'
import { appendSessionOutbox, lastStatusAt } from './outbox.ts'
import { pendingSessionInbox, readSessionInbox, sessionInboxItem } from './inbox.ts'

export const SESSION_IMAGE_BUDGET_BYTES = 8 * 1024 * 1024
const SUPPORTED_IMAGES = new Set(['image/jpeg', 'image/png', 'image/webp'])

export interface SessionToolContext {
  pool: Pool
  config: ProcessingConfig
  store?: BlobStore
  statusIntervalMs: number
  /** Image bytes already returned, by provider run (capability digest). */
  imageBudget: Map<string, number>
  /** Media versions actually returned to each lineage by fetch_evidence. */
  deliveredMedia: Map<string, Set<string>>
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

type LockedCapture = Awaited<ReturnType<typeof lockCaptureForInputSettlement>>

/**
 * Runs one tool call in its own transaction, under the same locks as session lifecycle changes:
 * capture (when publishing), then job and attempt, then the session row. The capability and the
 * running state are checked again under those locks, so a call racing a revoke, cancel or
 * settlement is refused with no change.
 */
async function withSession(
  context: SessionToolContext,
  token: string,
  options: { capture: boolean },
  work: (
    client: PoolClient,
    principal: SessionPrincipal,
    capture: LockedCapture | undefined,
  ) => Promise<SessionToolOutput['result'] | SessionToolOutput>,
): Promise<SessionToolOutput> {
  try {
    return await transaction(context.pool, async (client) => {
      const found =
        (await resolveSessionCapability(client, token)) ??
        refuse('capability_refused', 'This session capability is not valid.')
      const capture = options.capture
        ? await lockCaptureForInputSettlement(client, context.config, found.batchId)
        : undefined
      const { job, attempt } = await lockProcessingAttempt(client, found.jobId, found.attemptId)
      const live = await executeDatabaseQuery(
        queryDatabase(client)
          .select({ attemptId: agentSessions.attemptId })
          .from(agentSessions)
          .where(
            and(
              eq(agentSessions.attemptId, found.attemptId),
              eq(agentSessions.capabilitySha256, capabilityDigest(token)),
              eq(agentSessions.sessionState, 'running'),
            ),
          )
          .for('update'),
      )
      if (!live.length || attempt.state !== 'running' || job.current_attempt_id !== attempt.id) {
        refuse('capability_refused', 'This session capability is not valid.')
      }
      if (capture?.snapshot.archived) {
        refuse('session_not_running', 'This session can no longer publish results.')
      }
      const output = await work(client, found, capture)
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

/**
 * Every citation must come from what this session was given: notes from its opening manifest,
 * media it actually fetched, inbox items of its lineage, and proposals pinned for it or its own.
 */
async function requireDeliveredSources(
  client: PoolClient,
  context: SessionToolContext,
  principal: SessionPrincipal,
  proposal: ProcessingProposalV5Dto,
) {
  const manifest = principal.manifest
  const inManifest = deliveredSourceCheck({
    batchId: manifest.batch_id,
    notes: manifest.notes,
    media: manifest.media,
  })
  const fetched = context.deliveredMedia.get(principal.jobId) ?? new Set<string>()

  const delivered = (source: ProcessingSourceDto) =>
    inManifest(source) && (source.kind === 'note' || fetched.has(source.version_id))

  for (const source of [...proposal.sources, ...catalogueSources(proposal)]) {
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
          .select({ jobId: processingAttempts.jobId })
          .from(processingProposals)
          .innerJoin(processingAttempts, eq(processingAttempts.id, processingProposals.attemptId))
          .where(eq(processingProposals.id, source.proposal_id)),
      )
      const own = rows[0]?.jobId === principal.jobId
      if (!own && !manifest.pinned_proposal_ids.includes(source.proposal_id)) {
        refuse('source_not_delivered', 'A relied-on proposal was not delivered to this session.')
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
  capture: LockedCapture,
  principal: SessionPrincipal,
  kind: 'proposal' | 'question',
  payload: ProcessingProposalV5Dto | SessionAskArgsDto,
) {
  // withSession holds the capture, job, attempt and session locks.
  const attempts = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ lastSequence: processingAttempts.lastSequence })
      .from(processingAttempts)
      .where(eq(processingAttempts.id, principal.attemptId)),
  )
  const attempt = { id: principal.attemptId }
  const sequence = attempts[0].lastSequence + 1n
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
      withSession(context, token, { capture: false }, async (client, principal) => {
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
      withSession(context, token, { capture: false }, async (client, principal) => {
        const reply = validated<{ inbox_item_id: string; text: string }>('SessionReplyArgs', args)
        if (!(await sessionInboxItem(client, principal.lineageId!, reply.inbox_item_id))) {
          refuse('inbox_item_unknown', 'That inbox item does not belong to this session.')
        }
        // One reply per inbox item: a redelivered item adopts the reply already published.
        const earlier = await executeDatabaseQuery(
          queryDatabase(client)
            .select({ seq: agentSessionOutbox.seq })
            .from(agentSessionOutbox)
            .innerJoin(agentSessions, eq(agentSessions.attemptId, agentSessionOutbox.sessionId))
            .where(
              and(
                eq(agentSessions.sessionLineageId, principal.jobId),
                eq(agentSessionOutbox.kind, 'reply'),
                sql`${agentSessionOutbox.payload}->>'inbox_item_id' = ${reply.inbox_item_id}`,
              ),
            )
            .limit(1),
        )
        if (earlier.length) {
          return ok(client, principal)
        }
        await appendSessionOutbox(client, principal.attemptId, { kind: 'reply', payload: reply })
        await appendEvent(client, await batchStream(client, principal.batchId), 'session_changed', {
          batch_id: principal.batchId,
        })
        return ok(client, principal)
      }),

    read_inbox: (token: string, args: unknown) =>
      withSession(context, token, { capture: false }, async (client, principal) => {
        const { after_seq } = validated<{ after_seq: string }>('SessionReadInboxArgs', args)
        const items = await readSessionInbox(client, principal.lineageId!, BigInt(after_seq))
        return ok(client, principal, { items })
      }),

    propose: (token: string, args: unknown) =>
      withSession(context, token, { capture: true }, async (client, principal, capture) => {
        const { proposal } = validated<{ proposal: ProcessingProposalV5Dto }>(
          'SessionProposeArgs',
          args,
        )
        if (principal.subjectId === null || proposal.subject_id !== principal.subjectId) {
          refuse('validation_failed', 'A proposal must be for this session’s lot.')
        }
        await requireDeliveredSources(client, context, principal, proposal)
        const { messageId, streamId } = await retainSessionMessage(
          client,
          capture!,
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
      withSession(context, token, { capture: true }, async (client, principal, capture) => {
        const ask = validated<SessionAskArgsDto>('SessionAskArgs', args)
        if (principal.subjectId === null || ask.subject_id !== principal.subjectId) {
          refuse('validation_failed', 'A question must be about this session’s lot.')
        }
        const { messageId, streamId } = await retainSessionMessage(
          client,
          capture!,
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
      withSession(context, token, { capture: false }, async (client, principal) => {
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
        // The budget belongs to this provider run and is reserved before any await.
        const run = capabilityDigest(token).toString('hex')
        const used = context.imageBudget.get(run) ?? 0
        const size = Number(version!.byteSize)
        const fits = size <= SESSION_IMAGE_BUDGET_BYTES - used
        if (!context.store || !SUPPORTED_IMAGES.has(version!.mediaType) || !fits) {
          return ok(client, principal, { id: version!.versionId })
        }
        context.imageBudget.set(run, used + size)
        let bytes: Buffer
        try {
          bytes = await mediaContent(context.pool, context.config, context.store).original(
            principal.batchId,
            version!.versionId,
          )
        } catch (error) {
          context.imageBudget.set(run, (context.imageBudget.get(run) ?? size) - size)
          throw error
        }
        if (
          bytes.length.toString() !== version!.byteSize ||
          sha256(bytes).toString('hex') !== version!.digest
        ) {
          throw new Error('agent_media_invalid')
        }
        const fetched = context.deliveredMedia.get(principal.jobId) ?? new Set<string>()
        fetched.add(version!.versionId)
        context.deliveredMedia.set(principal.jobId, fetched)
        return {
          result: await ok(client, principal, { id: version!.versionId }),
          images: [{ mediaType: version!.mediaType, base64: bytes.toString('base64') }],
        }
      }),
  }
}
