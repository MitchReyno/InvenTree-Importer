import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import type { Pool, PoolClient } from 'pg'
import {
  validate,
  validationIssues,
  type ValidationIssue,
  type ProcessingMediaSourceDto,
  type ProposeLotArgsDto,
  type RecordObservationArgsDto,
  type RegroupArgsDto,
  type ProcessingSourceDto,
  type SessionPhotoViewDto,
  type SessionProposalDto,
  type WebPageSourceDto,
  type ProcessingRelianceDto,
  type SessionAskArgsDto,
  type SessionToolErrorDto,
  type SessionToolResultDto,
  webPageUrlAccepted,
} from '@invimport/contracts'
import { executeDatabaseQuery, queryDatabase, transaction } from '#/db/database.ts'
import { onLeadIdentity } from '#/processing/stable-identity.ts'
import { appendEvent } from '#/db/authority.ts'
import { captureBatches } from '#/capture/schema.ts'
import { lockCaptureForAgentWrite, lockCaptureForInputSettlement } from '#/capture/repository.ts'
import { CaptureError } from '#/capture/model.ts'
import {
  leadBatchView,
  proposeLot,
  recordObservation,
  regroup,
  type LotFormingResult,
} from '#/capture/evidence-observations.ts'
import type { ProcessingConfig } from '#/processing/attempts.ts'
import { sealed } from '#/processing/model.ts'
import { MAX_JOB_RESULTS, MAX_PROCESSING_SNAPSHOT_BYTES } from '#/processing/limits.ts'
import { catalogueSources, deliveredSourceCheck } from '#/processing/provenance.ts'
import { lockProcessingAttempt } from '#/processing/state.ts'
import {
  processingAttempts,
  processingMessages,
  processingProposals,
  processingQuestions,
} from '#/processing/schema.ts'
import { decodeMediaInputs } from '#/media/inputs.ts'
import type { BlobStore } from '#/media/blob-store.ts'
import { sha256 } from '#/db/authority.ts'
import { capabilityDigest, resolveSessionCapability, type SessionPrincipal } from './capability.ts'
import { agentSessionOutbox, agentSessions } from '#/agents/schema.ts'
import { appendSessionOutbox, lastStatusAt } from './outbox.ts'
import sharp from 'sharp'
import { regionCropCache } from '#/media/region-crops.ts'
import { pendingSessionInbox, readSessionInbox, sessionInboxItem } from './inbox.ts'
import { removedVersionIds, versionRemovedSql } from '#/media/removal.ts'

export const SESSION_IMAGE_BUDGET_BYTES = 8 * 1024 * 1024

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
/** A session's fetchable versions: its pinned media plus versions sent to it as notices. */
async function deliverableVersions(client: PoolClient, principal: SessionPrincipal) {
  // The lead session works from originals; a lot session may also be pinned derived versions.
  const examine = (principal.manifest.stage as string) === 'examine'
  const pinned = decodeMediaInputs(
    Buffer.from(principal.manifest.media.manifest, 'utf8'),
    Buffer.from(principal.manifest.media.sha256, 'hex'),
  ).versions.filter((item) => !examine || item.kind === 'original')
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
 * Every image an agent receives fits this long edge: Claude's high-resolution maximum, which it
 * downscales anything larger to, and inside every provider's per-image pixel and size limits.
 */
export const AGENT_IMAGE_LONG_EDGE = 2576

/**
 * The most one encoded agent image may be. Its base64 stays inside the smallest relay frame a
 * tool reply crosses (about 2 MiB) and far inside every provider's per-image size limit.
 */
export const AGENT_IMAGE_MAX_BYTES = 1_310_720

/** JPEG qualities tried in turn until an image fits `AGENT_IMAGE_MAX_BYTES`. */
const JPEG_QUALITIES = [90, 80, 70, 60]
const SCALE_DECIMALS = 10_000

interface DeliveredImage {
  bytes: Buffer
  mediaType: 'image/png' | 'image/jpeg'
  width: number
  height: number
  scale: number
}

/**
 * The image no larger than `longEdge` and `AGENT_IMAGE_MAX_BYTES`, or null when even the
 * lowest JPEG quality is too large. A lossless request tries PNG first. `scale` is the
 * delivered long edge per source long edge, so a reader can map positions back.
 */
async function boundedImage(
  source: Buffer,
  size: { width: number; height: number },
  longEdge: number,
  lossless: boolean,
): Promise<DeliveredImage | null> {
  const sourceLongEdge = Math.max(size.width, size.height)
  const decoded = sharp(source, { limitInputPixels: false })
  const fitted =
    sourceLongEdge > longEdge
      ? decoded.resize({ width: longEdge, height: longEdge, fit: 'inside' })
      : decoded
  const { data, info } = await fitted.raw().toBuffer({ resolveWithObject: true })

  const pixels = () =>
    sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } })

  const scale =
    sourceLongEdge > longEdge
      ? Math.round((Math.max(info.width, info.height) / sourceLongEdge) * SCALE_DECIMALS) /
        SCALE_DECIMALS
      : 1

  const delivered = (bytes: Buffer, mediaType: DeliveredImage['mediaType']) => ({
    bytes,
    mediaType,
    width: info.width,
    height: info.height,
    scale,
  })

  if (lossless) {
    const png = await pixels().png().toBuffer()
    if (png.length <= AGENT_IMAGE_MAX_BYTES) {
      return delivered(png, 'image/png')
    }
  }
  for (const quality of JPEG_QUALITIES) {
    const jpeg = await pixels()
      .flatten({ background: '#ffffff' })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer()
    if (jpeg.length <= AGENT_IMAGE_MAX_BYTES) {
      return delivered(jpeg, 'image/jpeg')
    }
  }
  return null
}

/**
 * A session's evidence, always cut from the decoded page preview and never the original upload.
 * A whole page comes back bounded (the lead session's overview smaller still); a region is cut
 * from the full preview, then bounded. Every answer lists each page's full preview size, which
 * regions are measured against, and describes the image actually delivered.
 */
async function fetchEvidenceImage(
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
        source: ProcessingMediaSourceDto
        preview: { id: string; page: number; width: number; height: number; digest: string }
        examine: boolean
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
      const delivered = await deliverableVersions(client, principal)
      const version = delivered.find(
        (item) =>
          item.evidence_id === request.evidence_id &&
          (request.version_id === undefined || item.version_id === request.version_id),
      )
      if (!version) {
        refuse('source_not_delivered', 'That evidence was not delivered to this session.')
      }
      await refuseRemovedVersions(client, principal.batchId, [version!.version_id])
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
      const sources = await client.query<{ sha256: string }>(
        "SELECT encode(blob_digest,'hex') AS sha256 FROM media_version WHERE batch_id=$1 AND id=$2 AND evidence_id=$3",
        [principal.batchId, version!.version_id, request.evidence_id],
      )
      const original = sources.rows[0]
      if (!original) {
        refuse('source_not_delivered', 'That evidence version is outside this session.')
      }
      plan = {
        source: {
          kind: 'media_version',
          evidence_id: request.evidence_id,
          version_id: version!.version_id,
          sha256: original!.sha256,
        },
        batchId: principal.batchId,
        jobId: principal.jobId,
        versionId: version!.version_id,
        preview: preview!,
        region: request.region,
        examine: (principal.manifest.stage as string) === 'examine',
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
  const { preview, region, batchId, versionId } = plan

  const source = () => context.store!.read(preview.digest)

  const delivered = region
    ? await boundedImage(
        (
          await regionCropCache(context.cropCacheDir!).crop(
            { versionId: plan.versionId, page: preview.page },
            { kind: 'pixels', ...region },
            source,
          )
        ).bytes,
        region,
        AGENT_IMAGE_LONG_EDGE,
        region.width <= AGENT_IMAGE_LONG_EDGE && region.height <= AGENT_IMAGE_LONG_EDGE,
      )
    : plan.examine
      ? await boundedImage(await source(), preview, LEAD_PREVIEW_LONG_EDGE, true)
      : await boundedImage(
          await source(),
          preview,
          AGENT_IMAGE_LONG_EDGE,
          preview.width <= AGENT_IMAGE_LONG_EDGE && preview.height <= AGENT_IMAGE_LONG_EDGE,
        )
  // An image too large to send at any quality comes back as metadata, like an exhausted budget.
  // The budget is reserved before the final transaction, so concurrent fetches can't overspend.
  const image =
    delivered && reserveImageBudget(context, run, delivered.bytes.length) ? delivered : null
  const view: SessionPhotoViewDto | null = image
    ? {
        evidence_id: plan.source.evidence_id,
        version_id: versionId,
        page: preview.page,
        ...(region
          ? { region: { x: region.x, y: region.y, width: region.width, height: region.height } }
          : {}),
        delivered: {
          width: image.width,
          height: image.height,
          media_type: image.mediaType,
          sha256: sha256(image.bytes).toString('hex'),
        },
      }
    : null
  // A refusal or a known rollback sends nothing, so it releases the reservation. An unknown
  // commit keeps it: the view may exist for the withheld image.
  let finished: FinalFetchOutcome
  try {
    finished = await finishEvidenceFetch(context, token, { batchId, versionId }, view)
  } catch (error) {
    if (image) {
      releaseImageBudget(context, run, image.bytes.length)
    }
    throw error
  }
  if (finished.kind === 'refused') {
    if (image) {
      releaseImageBudget(context, run, image.bytes.length)
    }
    return finished.output
  }
  if (finished.kind === 'uncertain') {
    return {
      result: {
        ok: false,
        error: 'outcome_uncertain',
        message:
          'The image was withheld because recording this view was not confirmed. Fetch it again if you still need it.',
        pending_inbox: finished.pending,
      },
    }
  }
  if (!image || !view) {
    return { result: { ...authorized.result, pending_inbox: finished.pending } }
  }
  const fetched = context.deliveredMedia.get(plan.jobId) ?? new Set<string>()
  fetched.add(plan.versionId)
  context.deliveredMedia.set(plan.jobId, fetched)
  return {
    result: {
      ...authorized.result,
      pending_inbox: finished.pending,
      source: plan.source,
      delivered: {
        page: preview.page,
        width: image.width,
        height: image.height,
        scale: image.scale,
        ...(view.region ? { region: view.region } : {}),
        media_type: image.mediaType,
        sha256: view.delivered.sha256,
      },
    },
    images: [{ mediaType: image.mediaType, base64: image.bytes.toString('base64') }],
  }
}

/** Reserves image bytes for a provider run; false when they would exceed its budget. */
function reserveImageBudget(context: SessionToolContext, run: string, bytes: number) {
  const used = context.imageBudget.get(run) ?? 0
  if (bytes > SESSION_IMAGE_BUDGET_BYTES - used) {
    return false
  }
  context.imageBudget.set(run, used + bytes)
  return true
}

function releaseImageBudget(context: SessionToolContext, run: string, bytes: number) {
  const remaining = (context.imageBudget.get(run) ?? 0) - bytes
  if (remaining > 0) {
    context.imageBudget.set(run, remaining)
  } else {
    context.imageBudget.delete(run)
  }
}

type FinalFetchOutcome =
  | { kind: 'committed'; pending: number }
  | { kind: 'refused'; output: SessionToolOutput }
  | { kind: 'uncertain'; pending: number }

/**
 * The fetch's final decision, after the read and encoding: the session may have ended, or the
 * operator removed the evidence, meanwhile. Under the batch, job, attempt and session locks it
 * re-checks what every tool call checks and records the view, so a removal, revocation,
 * cancellation or supersession either commits first and refuses the fetch or waits for it.
 */
async function finishEvidenceFetch(
  context: SessionToolContext,
  token: string,
  target: { batchId: string; versionId: string },
  view: SessionPhotoViewDto | null,
): Promise<FinalFetchOutcome> {
  // Set once the transaction's work has returned: a throw after it came from COMMIT, whose
  // outcome is unknown; a throw before it rolled back.
  let workReturned = false
  let pendingBeforeCommit = 0
  try {
    const pending = await transaction(context.pool, async (client) => {
      const found =
        (await resolveSessionCapability(client, token)) ??
        refuse('capability_refused', 'This session capability is not valid.')
      const streamId = await shareBatchStream(client, found.batchId)
      await requireRunningSession(client, token, found)
      await refuseRemovedVersions(client, target.batchId, [target.versionId])
      if (view) {
        await appendSessionOutbox(client, found.attemptId, { kind: 'photo_view', payload: view })
        await appendEvent(client, streamId, 'session_changed', {
          batch_id: found.batchId,
        })
      }
      const count = await pendingSessionInbox(client, found.lineageId!)
      pendingBeforeCommit = count
      workReturned = true
      return count
    })
    return { kind: 'committed', pending }
  } catch (error) {
    // The fetch doesn't touch the inbox or its cursor, so the count read before COMMIT holds.
    if (workReturned && view) {
      return { kind: 'uncertain', pending: pendingBeforeCommit }
    }
    if (error instanceof ToolRefusal) {
      return { kind: 'refused', output: await refusalOutput(context, token, error) }
    }
    throw error
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
    readonly issues?: ValidationIssue[],
  ) {
    super(message)
  }
}

const refuse = (code: SessionToolErrorDto, message: string): never => {
  throw new ToolRefusal(code, message)
}

function validated<T>(name: Parameters<typeof validate>[0], value: unknown): T {
  const issues = validationIssues(name, value)
  if (issues.length) {
    throw new ToolRefusal(
      'validation_failed',
      `Arguments do not match ${name}. Correct the listed fields and retry.`,
      issues,
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

/** Takes the batch row's share lock, first in the global lock order, and returns its stream. */
async function shareBatchStream(client: PoolClient, batchId: string) {
  const rows = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ streamId: captureBatches.streamId })
      .from(captureBatches)
      .where(eq(captureBatches.id, batchId))
      .for('share'),
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
      await requireRunningSession(client, token, found)
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
    return refusalOutput(context, token, error)
  }
}

/**
 * Locks the job, attempt and session rows, after any capture or batch lock, and refuses unless
 * the capability is still the running session's and its attempt is running and current.
 */
async function requireRunningSession(client: PoolClient, token: string, found: SessionPrincipal) {
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
}

/** A refused call's typed result, with the pending inbox read after its rollback. */
async function refusalOutput(
  context: SessionToolContext,
  token: string,
  error: ToolRefusal,
): Promise<SessionToolOutput> {
  const pending = await transaction(context.pool, async (client) => {
    const principal = await resolveSessionCapability(client, token)
    return principal ? pendingSessionInbox(client, principal.lineageId!) : 0
  })
  return {
    result: {
      ok: false,
      error: error.code,
      message: error.message,
      pending_inbox: pending,
      ...(error.issues ? { issues: error.issues } : {}),
    },
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
          if (error.code === 'media_evidence_removed') {
            refuse('media_evidence_removed', 'That evidence was deleted by the operator.')
          }
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
    return refusalOutput(context, token, error)
  }
}

async function ok(client: PoolClient, principal: SessionPrincipal, extra: object = {}) {
  return {
    ok: true as const,
    pending_inbox: await pendingSessionInbox(client, principal.lineageId!),
    ...extra,
  }
}

async function refuseRemovedVersions(
  client: PoolClient,
  batchId: string,
  versionIds: readonly string[],
) {
  if ((await removedVersionIds(client, batchId, versionIds)).size) {
    refuse('media_evidence_removed', 'That evidence was deleted by the operator.')
  }
}

/**
 * A proposal can't rely on deleted evidence, even evidence delivered before it was deleted: a
 * cited version, an observation on one, or an evidence note of a deleted item.
 */
async function refuseRemovedSources(
  client: PoolClient,
  batchId: string,
  sources: readonly (
    ProcessingSourceDto | WebPageSourceDto | ProcessingRelianceDto['sources'][number]
  )[],
) {
  const versions: string[] = []
  const observations: string[] = []
  const notes: string[] = []
  for (const source of sources) {
    if (source.kind === 'media_version') {
      versions.push(source.version_id)
    } else if (source.kind === 'evidence_observation') {
      observations.push(source.evidence_observation_id)
    } else if (source.kind === 'note') {
      notes.push(source.note_id)
    }
  }
  const removed = await client.query(
    `SELECT 1 FROM public.media_version v
     WHERE v.batch_id=$1 AND ${versionRemovedSql('v')}
       AND (v.id::text = ANY($2::text[])
         OR EXISTS (SELECT 1 FROM public.capture_evidence_observation o
                    WHERE o.evidence_version_id=v.id AND o.id::text = ANY($3::text[]))
         OR EXISTS (SELECT 1 FROM public.media_evidence_note n
                    WHERE n.evidence_id=v.evidence_id AND n.batch_id=v.batch_id
                      AND n.id::text = ANY($4::text[])))
     LIMIT 1`,
    [batchId, versions, observations, notes],
  )
  if (removed.rowCount) {
    refuse(
      'media_evidence_removed',
      'A cited source was deleted by the operator; cite current evidence.',
    )
  }
}

/**
 * The contract's pattern bounds a web page URL's scheme, length and authority; the URL parser
 * also has to accept it as an absolute http(s) URL with a host and no credentials.
 */
function refuseUnacceptedWebPages(proposal: SessionProposalDto) {
  proposal.sources.forEach((source, index) => {
    if (source.kind === 'web_page' && !webPageUrlAccepted(source.url)) {
      throw new ToolRefusal(
        'validation_failed',
        'A web page source must be an absolute http or https URL without credentials.',
        [
          {
            path: `/proposal/sources/${index}/url`,
            rule: 'format',
            reason: 'Use an absolute http or https URL without credentials.',
          },
        ],
      )
    }
  })
}

/**
 * Every citation must come from what this session was given: notes from its opening manifest,
 * media it actually fetched, inbox items of its lineage, and proposals pinned for it or its own.
 */
async function requireDeliveredSources(
  client: PoolClient,
  context: SessionToolContext,
  principal: SessionPrincipal,
  proposal: SessionProposalDto,
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

  // A version from an evidence notice is outside the manifest: fetching it delivered it, and a
  // citation must still name its own evidence and digest.
  const noticed = [...fetched].filter((id) => !manifestVersions.has(id))
  const actual = new Map(
    noticed.length
      ? (
          await client.query<{ id: string; evidence_id: string; sha256: string }>(
            `SELECT id, evidence_id, encode(blob_digest,'hex') AS sha256 FROM public.media_version
             WHERE batch_id=$1 AND id = ANY($2::uuid[])`,
            [principal.batchId, noticed],
          )
        ).rows.map((row) => [row.id, row])
      : [],
  )

  const delivered = (source: ProcessingSourceDto) => {
    if (source.kind === 'note') {
      return inManifest(source)
    }
    if (!fetched.has(source.version_id)) {
      return false
    }
    if (manifestVersions.has(source.version_id)) {
      return inManifest(source)
    }
    const version = actual.get(source.version_id)
    return version?.evidence_id === source.evidence_id && version.sha256 === source.sha256
  }

  for (const source of [...proposal.sources, ...catalogueSources(proposal)]) {
    // An agent-reported web page is the one source the app never delivers.
    if (source.kind === 'web_page') {
      continue
    }
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

/** `processing_message.envelope_bytes` holds at most this many bytes (migration 0006). */
const MAX_SESSION_ENVELOPE_BYTES = 32_768

interface SealedSessionEnvelope {
  sequence: bigint
  bytes: Buffer
  digest: Buffer
}

/**
 * Seals a session proposal or question as its attempt's next authenticated message, like runner
 * envelopes, and refuses one too large to store. Callers seal before any capacity check, so an
 * oversized result is always a correctable `validation_failed`.
 */
async function sealSessionEnvelope(
  client: PoolClient,
  principal: SessionPrincipal,
  kind: 'proposal' | 'question',
  payload: SessionProposalDto | SessionAskArgsDto,
): Promise<SealedSessionEnvelope> {
  // withSession holds the capture, job, attempt and session locks, so the sequence is stable.
  const attempts = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ lastSequence: processingAttempts.lastSequence })
      .from(processingAttempts)
      .where(eq(processingAttempts.id, principal.attemptId)),
  )
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
  // Field limits can't bound the sealed bytes: escaped or multibyte text, or many long web page
  // URLs, can still overrun the stored envelope's limit.
  if (envelope.bytes.length > MAX_SESSION_ENVELOPE_BYTES) {
    refuse(
      'validation_failed',
      `This ${kind} is ${envelope.bytes.length} bytes once sealed, over the ${MAX_SESSION_ENVELOPE_BYTES}-byte limit. Shorten its text or cite fewer sources.`,
    )
  }
  validate('SessionEnvelope', JSON.parse(envelope.bytes.toString('utf8')))
  return { sequence, bytes: envelope.bytes, digest: envelope.digest }
}

/** Stores a sealed envelope as the attempt's next message. */
async function retainSessionMessage(
  client: PoolClient,
  capture: LockedCapture,
  principal: SessionPrincipal,
  envelope: SealedSessionEnvelope,
) {
  const messageId = randomUUID()
  const db = queryDatabase(client)
  await executeDatabaseQuery(
    db.insert(processingMessages).values({
      id: messageId,
      attemptId: principal.attemptId,
      sequence: envelope.sequence,
      envelopeBytes: envelope.bytes,
      envelopeDigest: envelope.digest,
      disposition: 'accepted',
    }),
  )
  await executeDatabaseQuery(
    db
      .update(processingAttempts)
      .set({ lastSequence: envelope.sequence })
      .where(eq(processingAttempts.id, principal.attemptId)),
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
        const delivered = await deliverableVersions(client, principal)
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
          const { proposal } = validated<{ proposal: SessionProposalDto }>(
            'SessionProposeArgs',
            args,
          )
          refuseUnacceptedWebPages(proposal)
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
          await refuseRemovedSources(client, principal.batchId, [
            ...proposal.sources,
            ...catalogueSources(proposal),
            ...proposal.relies_on.sources,
          ])
          const envelope = await sealSessionEnvelope(client, principal, 'proposal', proposal)
          await requireRoom(client, principal, 'proposals', sealed(proposal).bytes.length)
          const { messageId, streamId } = await retainSessionMessage(
            client,
            capture!,
            principal,
            envelope,
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
        const envelope = await sealSessionEnvelope(client, principal, 'question', ask)
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
          envelope,
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

    fetch_evidence: async (token: string, args: unknown): Promise<SessionToolOutput> =>
      fetchEvidenceImage(context, token, capabilityDigest(token).toString('hex'), args),
  }
}
