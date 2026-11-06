import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import type { Pool, PoolClient } from 'pg'
import {
  validate,
  type ProposeLotArgsDto,
  type RecordObservationArgsDto,
  type RegroupArgsDto,
  type ProcessingProposalV5Dto,
  type ProcessingSourceDto,
  type SessionAskArgsDto,
  type SessionToolErrorDto,
  type SessionToolResultDto,
} from '@invimport/contracts'
import { executeDatabaseQuery, queryDatabase, transaction } from '../../db/database.ts'
import { onLeadIdentity } from '../../processing/stable-identity.ts'
import { appendEvent } from '../../db/authority.ts'
import { captureBatches } from '../../capture/schema.ts'
import {
  CaptureError,
  lockCaptureForAgentWrite,
  lockCaptureForInputSettlement,
} from '../../capture/repository.ts'
import {
  leadBatchView,
  proposeLot,
  recordObservation,
  regroup,
  type LotFormingResult,
} from '../../capture/evidence-observations.ts'
import type { ProcessingConfig } from '../../processing/attempts.ts'
import { sealed } from '../../processing/model.ts'
import { MAX_JOB_RESULTS, MAX_PROCESSING_SNAPSHOT_BYTES } from '../../processing/limits.ts'
import { catalogueSources, deliveredSourceCheck } from '../../processing/provenance.ts'
import { lockProcessingAttempt } from '../../processing/state.ts'
import {
  processingAttempts,
  processingMessages,
  processingProposals,
  processingQuestions,
} from '../../processing/schema.ts'
import { decodeMediaInputs, type MediaInputVersion } from '../../media/inputs.ts'
import { mediaContent } from '../../media/content.ts'
import type { BlobStore } from '../../media/blob-store.ts'
import { sha256 } from '../../db/authority.ts'
import { capabilityDigest, resolveSessionCapability, type SessionPrincipal } from './capability.ts'
import { agentSessionOutbox, agentSessions } from '../schema.ts'
import { appendSessionOutbox, lastStatusAt } from './outbox.ts'
import sharp from 'sharp'
import { regionCropCache } from '../../media/region-crops.ts'
import { pendingSessionInbox, readSessionInbox, sessionInboxItem } from './inbox.ts'

export const SESSION_IMAGE_BUDGET_BYTES = 8 * 1024 * 1024
const SUPPORTED_IMAGES = new Set(['image/jpeg', 'image/png', 'image/webp'])

export interface SessionToolContext {
  pool: Pool
  /** The `agent_writer` pool for the Examine lead session's capture writes. */
  writerPool?: Pool
  config: ProcessingConfig
  store?: BlobStore
  statusIntervalMs: number
  /** Image bytes already returned, by provider run (capability digest). */
  imageBudget: Map<string, number>
  /** Media versions actually returned to each lineage by fetch_evidence. */
  deliveredMedia: Map<string, Set<string>>
  /** Private directory for region crops, outside the blob store. */
  cropCacheDir?: string
}

/** The lead session's evidence: originals pinned in its manifest plus versions sent as notices. */
async function leadDeliveredVersions(client: PoolClient, principal: SessionPrincipal) {
  const pinned = decodeMediaInputs(
    Buffer.from(principal.manifest.media.manifest, 'utf8'),
    Buffer.from(principal.manifest.media.sha256, 'hex'),
  ).versions.filter((item) => item.kind === 'original')
  const notices = await client.query<{ evidence_id: string; version_id: string }>(
    `SELECT payload->>'evidence_id' AS evidence_id, payload->>'version_id' AS version_id
     FROM public.agent_session_inbox WHERE session_lineage_id=$1 AND kind='evidence'`,
    [principal.lineageId],
  )
  return [
    ...pinned.map((item) => ({ evidence_id: item.evidenceId, version_id: item.versionId })),
    ...notices.rows,
  ]
}

/** Lead-session previews are downscaled to this long edge before they reach the agent. */
export const LEAD_PREVIEW_LONG_EDGE = 768

/**
 * A session's evidence as previews: its pinned media plus versions sent to it as evidence
 * notices. The lead session always fetches this way; a lot session does for pages, region
 * crops and versions it learned of from a notice. Previews come back downscaled; a region comes back as a crop of the full preview.
 * Every answer lists each page's full preview size, which regions are measured against.
 */
async function previewFetchEvidence(
  context: SessionToolContext,
  token: string,
  run: string,
  args: unknown,
): Promise<SessionToolOutput> {
  let plan:
    | {
        batchId: string
        jobId: string
        versionId: string
        preview: { id: string; page: number; width: number; height: number; digest: string }
        region?: {
          x: number
          y: number
          width: number
          height: number
          source_width: number
          source_height: number
        }
      }
    | undefined
  const authorized = await withSession(
    context,
    token,
    { capture: false },
    async (client, principal) => {
      const request = validated<{
        evidence_id: string
        version_id?: string
        page?: number
        region?: {
          x: number
          y: number
          width: number
          height: number
          source_width: number
          source_height: number
        }
      }>('SessionFetchEvidenceArgs', args)
      const delivered = await leadDeliveredVersions(client, principal)
      const version = delivered.find(
        (item) =>
          item.evidence_id === request.evidence_id &&
          (request.version_id === undefined || item.version_id === request.version_id),
      )
      if (!version) {
        refuse('source_not_delivered', 'That evidence was not delivered to this session.')
      }
      const previews = await client.query<{
        id: string
        page: number
        width: number
        height: number
        digest: string
      }>(
        `SELECT id,page,width,height,encode(blob_digest,'hex') AS digest FROM public.media_preview
       WHERE batch_id=$1 AND version_id=$2 ORDER BY page`,
        [principal.batchId, version!.version_id],
      )
      const page = request.page ?? 1
      const preview = previews.rows.find((row) => row.page === page)
      if (!preview) {
        refuse('validation_failed', 'That page has no preview yet.')
      }
      if (
        request.region &&
        (request.region.source_width !== preview!.width ||
          request.region.source_height !== preview!.height ||
          request.region.x + request.region.width > preview!.width ||
          request.region.y + request.region.height > preview!.height)
      ) {
        refuse('validation_failed', 'The region must lie within the page preview it names.')
      }
      plan = {
        batchId: principal.batchId,
        jobId: principal.jobId,
        versionId: version!.version_id,
        preview: preview!,
        region: request.region,
      }
      const described = await client.query<{ label: string; note: string | null }>(
        `SELECT e.label,
         (SELECT n.text FROM public.media_evidence_note n WHERE n.evidence_id=e.id
          ORDER BY n.revision DESC LIMIT 1) AS note
       FROM public.media_evidence e WHERE e.batch_id=$1 AND e.id=$2`,
        [principal.batchId, request.evidence_id],
      )
      const note = described.rows[0]?.note?.trim()
      return ok(client, principal, {
        id: version!.version_id,
        pages: previews.rows.map(({ page: number, width, height }) => ({
          page: number,
          width,
          height,
        })),
        evidence_label: described.rows[0]?.label,
        ...(note ? { evidence_note: note } : {}),
      })
    },
  )
  // Without a store or a private crop cache the agent gets page sizes but no image.
  if (!plan || !authorized.result.ok || !context.store || (plan.region && !context.cropCacheDir)) {
    return authorized
  }
  const { preview, region } = plan

  const source = () => context.store!.read(preview.digest)

  const bytes = region
    ? await regionCropCache(context.cropCacheDir!).crop(
        { versionId: plan.versionId, page: preview.page },
        { kind: 'pixels', ...region },
        source,
      )
    : await sharp(await source(), { limitInputPixels: false })
        .resize({
          width: LEAD_PREVIEW_LONG_EDGE,
          height: LEAD_PREVIEW_LONG_EDGE,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .png()
        .toBuffer()
  // The image budget counts what reaches the agent, reserved for this provider run.
  const used = context.imageBudget.get(run) ?? 0
  if (bytes.length > SESSION_IMAGE_BUDGET_BYTES - used) {
    return authorized
  }
  context.imageBudget.set(run, used + bytes.length)
  const fetched = context.deliveredMedia.get(plan.jobId) ?? new Set<string>()
  fetched.add(plan.versionId)
  context.deliveredMedia.set(plan.jobId, fetched)
  return {
    result: authorized.result,
    images: [{ mediaType: 'image/png', base64: bytes.toString('base64') }],
  }
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
  options: { capture: boolean; leadWriter?: boolean },
  work: (
    client: PoolClient,
    principal: SessionPrincipal,
    capture: LockedCapture | undefined,
    writer: boolean,
  ) => Promise<SessionToolOutput['result'] | SessionToolOutput>,
): Promise<SessionToolOutput> {
  try {
    // The Examine lead session's results can queue its lots' successors, which only the
    // agent_writer role may create; every other session writes as the runner.
    let writer = false
    if (options.leadWriter && context.writerPool) {
      const found = await resolveSessionCapability(context.pool, token)
      writer = found !== undefined && found !== null && found.subjectId === null
    }
    return await transaction(writer ? context.writerPool! : context.pool, async (client) => {
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
      const output = await work(client, found, capture, writer)
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

/**
 * Lot-forming tools: Examine lead session only, on the `agent_writer` pool. Capture is locked
 * first, then job and attempt; every session change locks those too, so a plain read of the
 * session row under them is current.
 */
async function withLeadSession(
  context: SessionToolContext,
  token: string,
  work: (client: PoolClient, principal: SessionPrincipal) => Promise<LotFormingResult>,
): Promise<SessionToolOutput> {
  try {
    const found =
      (await resolveSessionCapability(context.pool, token)) ??
      refuse('capability_refused', 'This session capability is not valid.')
    // The column's TypeScript type predates the Examine stage.
    if ((found.stage as string) !== 'examine' || found.subjectId !== null) {
      refuse('tool_not_allowed', 'Only the batch Examine lead session can form lots.')
    }
    const pool =
      context.writerPool ?? refuse('tool_not_allowed', 'This worker cannot write capture state.')
    return await transaction(pool, async (client) => {
      try {
        await lockCaptureForAgentWrite(client, context.config, found.batchId)
      } catch (error) {
        if (error instanceof CaptureError && error.code === 'batch_archived') {
          refuse('session_not_running', 'This session can no longer publish results.')
        }
        throw error
      }
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
          ),
      )
      if (!live.length || attempt.state !== 'running' || job.current_attempt_id !== attempt.id) {
        refuse('capability_refused', 'This session capability is not valid.')
      }
      let result: LotFormingResult
      try {
        result = await work(client, found)
      } catch (error) {
        if (error instanceof CaptureError) {
          if (error.code === 'capture_capacity') {
            refuse('capacity_reached', 'This batch has reached its limit of lots or observations.')
          }
          refuse('validation_failed', `The capture change was refused: ${error.code}.`)
        }
        throw error
      }
      const pending = await pendingSessionInbox(client, found.lineageId!)
      if (!result.ok) {
        return {
          result: {
            ok: false,
            error: 'stale',
            message: 'Rows changed after base_revision; re-read and re-plan.',
            pending_inbox: pending,
            revision: result.revision,
            conflicts: result.conflicts,
          },
        }
      }
      return {
        result: {
          ok: true,
          pending_inbox: pending,
          revision: result.revision,
          id: result.id,
          suggested: result.suggested,
          ...(result.partSubjectId ? { part_subject_id: result.partSubjectId } : {}),
        },
      }
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

  const manifestVersions = new Set(
    decodeMediaInputs(
      Buffer.from(manifest.media.manifest, 'utf8'),
      Buffer.from(manifest.media.sha256, 'hex'),
    ).versions.map((item) => item.versionId),
  )

  // A version from an evidence notice is outside the manifest; fetching it delivered it.
  const delivered = (source: ProcessingSourceDto) =>
    source.kind === 'note'
      ? inManifest(source)
      : fetched.has(source.version_id) &&
        (manifestVersions.has(source.version_id) ? inManifest(source) : true)

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
    } else if (source.kind === 'observation_set') {
      // The lead session may rely on any lot of its batch; a lot session on its own lot only.
      const lots = await client.query(
        'SELECT 1 FROM public.capture_lot WHERE id=$1 AND batch_id=$2',
        [source.lot_id, principal.batchId],
      )
      if (
        !lots.rowCount ||
        (principal.subjectId !== null && source.lot_id !== principal.subjectId)
      ) {
        refuse('source_not_delivered', 'A relied-on lot does not belong to this session.')
      }
    } else {
      // An observation of the batch; a lot session sees only its lot's members.
      const rows = await client.query(
        principal.subjectId === null
          ? 'SELECT 1 FROM public.capture_evidence_observation WHERE id=$1 AND batch_id=$2'
          : `SELECT 1 FROM public.capture_lot_evidence_observation
             WHERE evidence_observation_id=$1 AND batch_id=$2 AND lot_id=$3 AND status='active'`,
        principal.subjectId === null
          ? [source.evidence_observation_id, principal.batchId]
          : [source.evidence_observation_id, principal.batchId, principal.subjectId],
      )
      if (!rows.rowCount) {
        refuse('source_not_delivered', 'A relied-on observation was not delivered to this session.')
      }
    }
  }
}

/** The Processing snapshot reads at most this many proposals and questions per attempt. */
/** Half the snapshot budget, leaving room for JSON framing and the rest of the snapshot. */
const SESSION_RESULT_BUDGET_BYTES = MAX_PROCESSING_SNAPSHOT_BYTES / 2
/** A generous upper bound for the read-model fields around one proposal or question. */
const RESULT_PROJECTION_BYTES = 512

async function requireRoom(
  client: PoolClient,
  principal: SessionPrincipal,
  label: 'proposals' | 'questions',
  newBytes: number,
) {
  // Proposals are read per attempt and questions per job, so each limit uses the same scope.
  const query =
    label === 'proposals'
      ? queryDatabase(client)
          .select({ count: sql<number>`count(*)::int` })
          .from(processingProposals)
          .where(eq(processingProposals.attemptId, principal.attemptId))
      : queryDatabase(client)
          .select({ count: sql<number>`count(*)::int` })
          .from(processingQuestions)
          .where(eq(processingQuestions.jobId, principal.jobId))
  const rows = await executeDatabaseQuery(query)
  if (rows[0].count >= MAX_JOB_RESULTS) {
    refuse(
      'capacity_reached',
      `This session has published its limit of ${MAX_JOB_RESULTS} ${label}.`,
    )
  }
  // The whole batch snapshot has a byte budget too; keep retained results within half of it.
  // Retained bytes plus a per-item allowance for the projection around each result (IDs,
  // digests, states), so many small results cannot overflow the snapshot either.
  const retained = await client.query<{ bytes: string }>(
    `SELECT (COALESCE((SELECT sum(octet_length(p.value_bytes)+${RESULT_PROJECTION_BYTES}) FROM public.processing_proposal p
        JOIN public.processing_attempt a ON a.id=p.attempt_id WHERE a.batch_id=$1),0)
      + COALESCE((SELECT sum(octet_length(q.spec_bytes)+${RESULT_PROJECTION_BYTES}) FROM public.processing_question q
        WHERE q.batch_id=$1),0))::text AS bytes`,
    [principal.batchId],
  )
  const projected = BigInt(retained.rows[0].bytes) + BigInt(newBytes + RESULT_PROJECTION_BYTES)
  if (projected > BigInt(SESSION_RESULT_BUDGET_BYTES)) {
    refuse('capacity_reached', 'This batch has reached the size limit for retained results.')
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
  const writer = (principal: SessionPrincipal) => ({
    config: context.config,
    batchId: principal.batchId,
    sessionId: principal.attemptId,
  })

  /** Each lot-forming write also lands in the session's outbox, so the timeline shows it. */
  const outboxed = async (
    client: PoolClient,
    principal: SessionPrincipal,
    result: LotFormingResult,
    item: (id: string) => Parameters<typeof appendSessionOutbox>[2],
  ) => {
    if (result.ok) {
      await appendSessionOutbox(client, principal.attemptId, item(result.id))
    }
    return result
  }

  return {
    read_batch: (token: string, args: unknown) =>
      withSession(context, token, { capture: false }, async (client, principal) => {
        validated('SessionReadBatchArgs', args)
        if ((principal.stage as string) !== 'examine') {
          refuse('tool_not_allowed', 'Only the batch Examine lead session reads the whole batch.')
        }
        return ok(client, principal, { batch: await leadBatchView(client, principal.batchId) })
      }),

    record_observation: (token: string, args: unknown) =>
      withLeadSession(context, token, async (client, principal) => {
        const input = validated<RecordObservationArgsDto>('RecordObservationArgs', args)
        // Only evidence this session was given; an observation also marks it as examined.
        const delivered = await leadDeliveredVersions(client, principal)
        if (!delivered.some((item) => item.version_id === input.evidence_version_id)) {
          refuse('source_not_delivered', 'That evidence was not delivered to this session.')
        }
        return outboxed(
          client,
          principal,
          await recordObservation(client, writer(principal), input),
          (id) => ({ kind: 'observation', payload: { evidence_observation_id: id } }),
        )
      }),

    propose_lot: (token: string, args: unknown) =>
      withLeadSession(context, token, async (client, principal) =>
        outboxed(
          client,
          principal,
          await proposeLot(
            client,
            writer(principal),
            validated<ProposeLotArgsDto>('ProposeLotArgs', args),
          ),
          (id) => ({ kind: 'lot', payload: { lot_id: id } }),
        ),
      ),

    regroup: (token: string, args: unknown) =>
      withLeadSession(context, token, async (client, principal) => {
        const input = validated<RegroupArgsDto>('RegroupArgs', args)
        return outboxed(client, principal, await regroup(client, writer(principal), input), () => ({
          kind: 'regroup',
          payload: { lot_ids: [...new Set(input.moves.map((move) => move.to_lot_id))] },
        }))
      }),

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
      withSession(
        context,
        token,
        { capture: true, leadWriter: true },
        async (client, principal, capture, writer) => {
          const { proposal } = validated<{ proposal: ProcessingProposalV5Dto }>(
            'SessionProposeArgs',
            args,
          )
          // The lead session proposes for any live lot of its batch; a lot session for its own lot.
          const lots = capture!.snapshot.lots.filter((lot) => !lot.retired).map((lot) => lot.id)
          if (
            principal.subjectId === null
              ? !lots.includes(proposal.subject_id)
              : proposal.subject_id !== principal.subjectId
          ) {
            refuse('validation_failed', 'A proposal must be for this session’s lot.')
          }
          await requireDeliveredSources(client, context, principal, proposal)
          await requireRoom(client, principal, 'proposals', sealed(proposal).bytes.length)
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
          // A stable identity from the lead session starts the lot's Research and Images.
          if (writer && principal.subjectId === null) {
            await onLeadIdentity(client, context.config, capture!.snapshot, proposal, id)
          }
          await appendEvent(client, streamId, 'processing_changed', { batch_id: principal.batchId })
          return ok(client, principal, { id })
        },
      ),

    ask: (token: string, args: unknown) =>
      withSession(context, token, { capture: true }, async (client, principal, capture) => {
        const ask = validated<SessionAskArgsDto>('SessionAskArgs', args)
        await requireRoom(client, principal, 'questions', sealed(ask).bytes.length)
        // Only the lead session may ask about the whole batch or another subject of it.
        const subjects = [
          ...capture!.snapshot.lots.filter((lot) => !lot.retired).map((lot) => lot.id),
          ...capture!.snapshot.parts.map((part) => part.id),
        ]
        if (
          principal.subjectId === null
            ? ask.subject_id !== null && !subjects.includes(ask.subject_id)
            : ask.subject_id !== principal.subjectId
        ) {
          refuse('validation_failed', 'A question must be about this session’s lot.')
        }
        // A quantity is answered on a lot, so a quantity question must name one.
        const lots = capture!.snapshot.lots.filter((lot) => !lot.retired).map((lot) => lot.id)
        if (
          ask.kind === 'quantity' &&
          (ask.subject_id === null || !lots.includes(ask.subject_id))
        ) {
          refuse('validation_failed', 'A quantity question must be about one live lot.')
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

    fetch_evidence: async (token: string, args: unknown): Promise<SessionToolOutput> => {
      const run = capabilityDigest(token).toString('hex')
      const found = await resolveSessionCapability(context.pool, token)
      const request = (args ?? {}) as { version_id?: unknown; region?: unknown; page?: unknown }

      const inManifest = (versionId: unknown) =>
        found !== null &&
        found !== undefined &&
        decodeMediaInputs(
          Buffer.from(found.manifest.media.manifest, 'utf8'),
          Buffer.from(found.manifest.media.sha256, 'hex'),
        ).versions.some((item) => item.versionId === versionId)

      if (
        found &&
        ((found.stage as string) === 'examine' ||
          request.region !== undefined ||
          request.page !== undefined ||
          (typeof request.version_id === 'string' && !inManifest(request.version_id)))
      ) {
        return previewFetchEvidence(context, token, run, args)
      }
      let reserved: { version: MediaInputVersion; jobId: string; batchId: string } | undefined
      // Authorize and reserve under the session locks; the bytes are read after the transaction,
      // so a fetch never holds one pooled connection while waiting for another.
      const authorized = await withSession(
        context,
        token,
        { capture: false },
        async (client, principal) => {
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
          const used = context.imageBudget.get(run) ?? 0
          const size = Number(version!.byteSize)
          if (
            context.store &&
            SUPPORTED_IMAGES.has(version!.mediaType) &&
            size <= SESSION_IMAGE_BUDGET_BYTES - used
          ) {
            context.imageBudget.set(run, used + size)
            reserved = { version: version!, jobId: principal.jobId, batchId: principal.batchId }
          }
          return ok(client, principal, { id: version!.versionId })
        },
      )
      if (!reserved || !authorized.result.ok) {
        return authorized
      }
      const { version, jobId, batchId } = reserved

      const refund = () =>
        context.imageBudget.set(run, (context.imageBudget.get(run) ?? 0) - Number(version.byteSize))

      let bytes: Buffer
      try {
        bytes = await mediaContent(context.pool, context.config, context.store!).original(
          batchId,
          version.versionId,
        )
      } catch (error) {
        refund()
        throw error
      }
      if (
        bytes.length.toString() !== version.byteSize ||
        sha256(bytes).toString('hex') !== version.digest
      ) {
        refund()
        throw new Error('agent_media_invalid')
      }
      // The session may have ended while the bytes were read; only a live one receives them.
      if (!(await resolveSessionCapability(context.pool, token))) {
        refund()
        return {
          result: {
            ok: false,
            error: 'capability_refused',
            message: 'This session capability is not valid.',
            pending_inbox: 0,
          },
        }
      }
      const fetched = context.deliveredMedia.get(jobId) ?? new Set<string>()
      fetched.add(version.versionId)
      context.deliveredMedia.set(jobId, fetched)
      return {
        result: authorized.result,
        images: [{ mediaType: version.mediaType, base64: bytes.toString('base64') }],
      }
    },
  }
}
