import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { and, eq, sql } from 'drizzle-orm'
import type { Pool, PoolClient } from 'pg'
import {
  MAX_ANSWER_SUMMARY_BYTES,
  validate,
  validationIssues,
  type ProcessingMediaSourceDto,
  type ProposeLotArgsDto,
  type RecordObservationArgsDto,
  type RegroupArgsDto,
  type ProcessingSourceDto,
  type SessionPhotoViewDto,
  type SessionProposalDto,
  type WebPageSourceDto,
  type ProcessingRelianceDto,
  type RetainedSessionProposalDto,
  type SessionAskArgsV2Dto,
  type SessionStageAskArgsDto,
  type SessionStageProposeArgsDto,
  type SessionReadBriefBatchArgsDto,
  type SessionReadLotArgsDto,
  type SessionToolErrorDto,
  type SessionToolResultDto,
  webPageUrlAccepted,
} from '@invimport/contracts'
import {
  cancelRunningStatement,
  executeDatabaseQuery,
  queryDatabase,
  transaction,
} from '#/db/database.ts'
import { notCurrent, recordIdentityBasis } from '#/processing/identity-basis.ts'
import {
  builtOn,
  earlierIdentities,
  onLeadIdentity,
  reliedObservationSet,
} from '#/processing/stable-identity.ts'
import { appendEvent } from '#/db/authority.ts'
import { captureBatches } from '#/capture/schema.ts'
import { lockCaptureForAgentWrite, lockCaptureForInputSettlement } from '#/capture/repository.ts'
import { CaptureError } from '#/capture/model.ts'
import {
  leadBatchView,
  proposeLot,
  recordLotEstimate,
  recordObservation,
  regroup,
  type LotFormingResult,
} from '#/capture/evidence-observations.ts'
import type { ProcessingConfig } from '#/processing/attempts.ts'
import { ProcessingError, sealed } from '#/processing/model.ts'
import { MAX_JOB_RESULTS, MAX_PROCESSING_SNAPSHOT_BYTES } from '#/processing/limits.ts'
import { deliveredSourceCheck, proposalCitations } from '#/processing/provenance.ts'
import { storableText } from '#/db/storable-text.ts'
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
import { refuse, ToolRefusal } from './refusal.ts'
import { stageOutputRefusal } from './stage-outputs.ts'
import {
  coveringQuestion,
  questionSubject,
  storeQuestionBasis,
  type QuestionBasis,
} from './question-dedupe.ts'
import { releasedPages } from './photo-release.ts'
import { readBriefPage, retainBriefView, stagePrincipal, type BriefRead } from './brief-read.ts'
import { agentSessionOutbox, agentSessions } from '#/agents/schema.ts'
import { appendSessionOutbox, lastStatusAt } from './outbox.ts'
import sharp from 'sharp'
import { regionCropCache } from '#/media/region-crops.ts'
import { lockInboxBatch, pendingSessionInbox, readSessionInbox, sessionInboxItem } from './inbox.ts'
import { stepRefusal, subjectRefusal } from './question-checks.ts'
import { resolveFigures, type ResolvedFigure } from './figures.ts'
import {
  enqueueFigureRenders,
  figureRecipeDigest,
  MAX_PENDING_PREVIEWS,
  pendingPreviewCount,
  previewRenders,
  type PreviewRow,
} from '#/media/figure-renders.ts'
import { removedVersionIds, versionRemovedSql } from '#/media/removal.ts'

export const SESSION_IMAGE_BUDGET_BYTES = 8 * 1024 * 1024

export function evidenceImageMode(value: string | undefined) {
  if (value === undefined || value === '' || value === 'preview') {
    return 'preview'
  }
  if (value === 'original') {
    return 'original'
  }
  throw new Error('invalid_vm_evidence_image')
}

export interface SessionToolContext {
  evidenceImage?: ReturnType<typeof evidenceImageMode>
  pool: Pool
  /** The `agent_writer` pool for the Examine lead session's capture writes. */
  writerPool?: Pool
  config: ProcessingConfig
  store?: BlobStore
  statusIntervalMs: number
  /** Image bytes already returned, by provider run (capability digest). */
  imageBudget: Map<string, number>
  /** Media versions and pages actually returned to each job's session by fetch_evidence. */
  deliveredMedia: DeliveredMedia
  /** Private directory for region crops, outside the blob store. */
  cropCacheDir?: string
  /** How long an `ask` preview waits for its renders; `FIGURE_PREVIEW_WAIT_MS` by default. */
  figurePreviewWaitMs?: number
}

/** An `ask` preview waits at most this long for the media worker to render its figures. */
export const FIGURE_PREVIEW_WAIT_MS = 20_000
/** How often a waiting preview checks its renders. */
const FIGURE_PREVIEW_POLL_MS = 200
/**
 * A preview's images together stay within this, so five of them in base64 fit the VM relay's
 * evidence frame (`evidenceReplyLimit`) with room for the result text.
 */
export const FIGURE_PREVIEW_MAX_BYTES = 6 * 1024 * 1024

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
 * A session's evidence, using its configured whole-photo rendition or a decoded page preview.
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
        attemptId: string
        versionId: string
        source: ProcessingMediaSourceDto
        preview: { id: string; page: number; width: number; height: number; digest: string }
        originalType?: DeliveredImage['mediaType']
        deferCitation: boolean
        examine: boolean
        /** A `/7` session cites a view only once its release is recorded, so it learns the view. */
        stageInput: boolean
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
      const sources = await client.query<{ sha256: string; media_type: string }>(
        "SELECT encode(blob_digest,'hex') AS sha256, media_type FROM media_version WHERE batch_id=$1 AND id=$2 AND evidence_id=$3",
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
        attemptId: principal.attemptId,
        versionId: version!.version_id,
        preview: preview!,
        originalType:
          context.evidenceImage === 'original' &&
          principal.manifest.profile_id === 'shared-vm-agent/3' &&
          !request.region &&
          (original!.media_type === 'image/jpeg' || original!.media_type === 'image/png')
            ? original!.media_type
            : undefined,
        region: request.region,
        deferCitation: principal.manifest.profile_id === 'shared-vm-agent/3',
        examine: (principal.manifest.stage as string) === 'examine',
        stageInput: principal.manifest.schema_version === 'bench-intake-input/7',
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

  const delivered = plan.originalType
    ? {
        bytes: await context.store.read(plan.source.sha256),
        mediaType: plan.originalType,
        width: preview.width,
        height: preview.height,
        scale: 1,
      }
    : region
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
  // A `/7` citation needs the view's recorded release instead.
  if (!plan.deferCitation && !plan.stageInput) {
    recordMediaDelivery(context.deliveredMedia, plan.jobId, plan.versionId, {
      attemptId: plan.attemptId,
      page: preview.page,
    })
  }
  return {
    result: {
      ...authorized.result,
      pending_inbox: finished.pending,
      ...(plan.stageInput && finished.viewSeq ? { view_seq: finished.viewSeq } : {}),
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

/** The pages of one version each attempt's conversation was given, by attempt ID. */
export type DeliveredPages = Map<string, Set<number>>

/**
 * Media actually given to each job's session: version, then the pages each attempt was given.
 * Versions prove citations for the job; pages belong to the attempt that saw them, so a Start
 * fresh conversation, a new attempt of the same job, must fetch a page again to show it.
 */
export type DeliveredMedia = Map<string, Map<string, DeliveredPages>>

/** A delivered page and the attempt whose conversation was given it. */
export interface DeliveredPage {
  attemptId: string
  page: number
}

/**
 * Records a delivered version and page. A delivery from a host that didn't report its page
 * proves the version for citations but grants no page for a figure.
 */
export function recordMediaDelivery(
  media: DeliveredMedia,
  job: string,
  version: string,
  delivered?: DeliveredPage,
) {
  const versions = media.get(job) ?? new Map<string, DeliveredPages>()
  const attempts = versions.get(version) ?? new Map<string, Set<number>>()
  if (delivered) {
    const pages = attempts.get(delivered.attemptId) ?? new Set<number>()
    pages.add(delivered.page)
    attempts.set(delivered.attemptId, pages)
  }
  versions.set(version, attempts)
  media.set(job, versions)
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
  | { kind: 'committed'; pending: number; viewSeq: string | null }
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
  let viewSeq: string | null = null
  try {
    const pending = await transaction(context.pool, async (client) => {
      const found =
        (await resolveSessionCapability(client, token)) ??
        refuse('capability_refused', 'This session capability is not valid.')
      const streamId = await shareBatchStream(client, found.batchId)
      await requireRunningSession(client, token, found)
      await refuseRemovedVersions(client, target.batchId, [target.versionId])
      if (view) {
        const seq = await appendSessionOutbox(client, found.attemptId, {
          kind: 'photo_view',
          payload: view,
        })
        viewSeq = seq.toString()
        await appendEvent(client, streamId, 'session_changed', {
          batch_id: found.batchId,
        })
      }
      const count = await pendingSessionInbox(client, found.lineageId!)
      pendingBeforeCommit = count
      workReturned = true
      return count
    })
    return { kind: 'committed', pending, viewSeq }
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
  options: { capture: boolean; leadWriter?: boolean; batchShare?: boolean },
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
      // Before the job, as everywhere: orders a read against an ungroup's withdrawal.
      if (options.batchShare && !capture) {
        await lockInboxBatch(client, found.lineageId!)
      }
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
 * Queues a stable identity's successors. A successor input over capacity (its brief past the
 * page bounds) is refused with its cause, and the whole proposal rolls back with it.
 */
async function queueSuccessors(queue: () => Promise<unknown>) {
  try {
    await queue()
  } catch (error) {
    if (error instanceof ProcessingError && error.code === 'processing_input_capacity') {
      refuse(
        'capacity_reached',
        'The lot’s Research and Images inputs would be over capacity, so this proposal was not published. Tell the operator.',
      )
    }
    throw error
  }
}

/** Whether a capability names a running `/7` session, which reads a brief. */
async function hasBrief(context: SessionToolContext, token: string) {
  const found = await resolveSessionCapability(context.pool, token)
  return found?.manifest.schema_version === 'bench-intake-input/7'
}

/**
 * A brief read in one repeatable-read snapshot, so a current view never mixes two revisions. It
 * takes no row locks, which a repeatable-read transaction could fail on, and writes nothing; it
 * checks that the capability names a running session whose attempt is running and current. A
 * read that starts a current view keeps it afterwards, in its own transaction.
 */
async function withBriefRead(
  context: SessionToolContext,
  token: string,
  work: (
    client: PoolClient,
    principal: SessionPrincipal,
  ) => Promise<{ result: SessionToolOutput['result']; read: BriefRead }>,
): Promise<SessionToolOutput> {
  try {
    const read = await transaction(context.pool, async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
      const found =
        (await resolveSessionCapability(client, token)) ??
        refuse('capability_refused', 'This session capability is not valid.')
      const current = await client.query(
        `SELECT 1 FROM public.processing_job j
         JOIN public.processing_attempt a ON a.id=j.current_attempt_id
         WHERE a.id=$1 AND a.state='running'`,
        [found.attemptId],
      )
      if (!current.rowCount) {
        refuse('capability_refused', 'This session capability is not valid.')
      }
      return { ...(await work(client, found)), attemptId: found.attemptId }
    })
    // Kept after the snapshot commits, so the page's token names a view that is kept.
    await retainBriefView(context.pool, read.attemptId, read.read)
    return { result: read.result }
  } catch (error) {
    if (!(error instanceof ToolRefusal)) {
      throw error
    }
    return refusalOutput(context, token, error)
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
 * A `/7` session publishes its stage's typed output, refused as correctable when its kind or a
 * field isn't its stage's or its mode's; earlier sessions publish `/5` or `/6`.
 */
function publishedProposal(principal: SessionPrincipal, args: unknown): RetainedSessionProposalDto {
  if (principal.manifest.schema_version !== 'bench-intake-input/7') {
    return validated<{ proposal: SessionProposalDto }>('SessionProposeArgs', args).proposal
  }
  const { proposal } = validated<SessionStageProposeArgsDto>('SessionStageProposeArgs', args)
  refuseUnstorableText(proposal, '/proposal')
  const refusal = stageOutputRefusal(principal.manifest, proposal)
  if (refusal) {
    throw refusal
  }
  return proposal
}

/**
 * A `/7` identity retires the lot's earlier ones, so it can't rely on one of them, or on anything
 * built on one: it would be current, and queue successors, while resting on what it made stale.
 */
async function refuseRelyingOnRetired(
  client: PoolClient,
  principal: SessionPrincipal,
  proposal: RetainedSessionProposalDto,
  proposalId: string,
) {
  const identity =
    principal.manifest.schema_version === 'bench-intake-input/7' &&
    proposal.schema_version === 'examine-identity/1' &&
    proposal.relies_on.fields.includes('identity')
  if (!identity) {
    return
  }
  // What retiring the lot's earlier identities would make stale, at any depth.
  const earlier = new Set(
    await builtOn(
      client,
      principal.batchId,
      await earlierIdentities(client, principal.batchId, proposal.subject_id, proposalId),
    ),
  )
  const index = proposal.relies_on.sources.findIndex(
    (source) => source.kind === 'proposal' && earlier.has(source.proposal_id),
  )
  if (index >= 0) {
    const reason = 'Rely on the evidence, not on the identity this one replaces.'
    throw new ToolRefusal(
      'validation_failed',
      `This identity replaces the one it relies on. ${reason}`,
      [{ path: `/proposal/relies_on/sources/${index}`, rule: 'not_allowed', reason }],
    )
  }
}

async function proposalStale(client: PoolClient, proposalId: string) {
  const rows = await client.query(
    'SELECT 1 FROM public.processing_proposal_stale WHERE proposal_id=$1',
    [proposalId],
  )
  return Boolean(rows.rowCount)
}

/**
 * A typed output's text goes into PostgreSQL text and jsonb, which refuse NUL and unpaired
 * surrogates the schema admits; the first such string is refused by its path.
 */
function refuseUnstorableText(value: unknown, path: string): void {
  if (typeof value === 'string') {
    if (!storableText(value)) {
      const reason = 'Text must not hold NUL or unpaired surrogates.'
      throw new ToolRefusal(
        'validation_failed',
        `${path} holds a character that can't be stored.`,
        [{ path, rule: 'schema', reason }],
      )
    }
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => refuseUnstorableText(item, `${path}/${index}`))
    return
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      refuseUnstorableText(item, `${path}/${key}`)
    }
  }
}

/** The quantity estimate a `/7` lead's identity carries, which becomes the lot's estimate. */
function leadEstimate(principal: SessionPrincipal, proposal: RetainedSessionProposalDto) {
  if (principal.subjectId !== null || proposal.schema_version !== 'examine-identity/1') {
    return undefined
  }
  return proposal.quantity
}

/** Under `/7` a lot's estimate is Examine's typed output's, so `propose_lot` takes none. */
function refuseStageEstimate(principal: SessionPrincipal, input: ProposeLotArgsDto) {
  if (principal.manifest.schema_version !== 'bench-intake-input/7') {
    return
  }
  const given = (['estimated_quantity', 'quantity_basis'] as const).filter(
    (field) => input[field] !== undefined,
  )
  if (!given.length) {
    return
  }
  const reason = 'Give the estimate in the lot’s examine-identity/1 quantity.'
  throw new ToolRefusal(
    'validation_failed',
    `propose_lot takes no ${given.join(' or ')} in this session. Retry without it, then publish the estimate as the quantity of the lot's examine-identity/1.`,
    given.map((field) => ({ path: `/${field}`, rule: 'not_allowed', reason })),
  )
}

/**
 * The contract's pattern bounds a web page URL's scheme, length and authority; the URL parser
 * also has to accept it as an absolute http(s) URL with a host and no credentials.
 */
function refuseUnacceptedWebPages(proposal: Pick<RetainedSessionProposalDto, 'sources'>) {
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
 * The pages of each version this session was given. A `/7` session's are the views whose release
 * was recorded on its current attempt, which a worker restart keeps; an earlier session's are what
 * this worker delivered to its job, with the pages its current attempt was shown.
 */
async function deliveredPages(
  client: PoolClient,
  context: SessionToolContext,
  principal: SessionPrincipal,
): Promise<Map<string, Set<number>>> {
  if (principal.manifest.schema_version === 'bench-intake-input/7') {
    return releasedPages(client, principal.attemptId)
  }
  const versions = context.deliveredMedia.get(principal.jobId) ?? new Map<string, DeliveredPages>()
  return new Map(
    [...versions].map(([version, attempts]) => [
      version,
      attempts.get(principal.attemptId) ?? new Set<number>(),
    ]),
  )
}

/**
 * Whether a cited note or media version was delivered to this session: a version counts once the
 * session fetched it, and manifest membership decides how its evidence and digest are checked.
 * Proposals and question figures share it.
 */
export async function deliveredSourcePredicate(
  client: PoolClient,
  context: SessionToolContext,
  principal: SessionPrincipal,
) {
  const manifest = principal.manifest
  const inManifest = deliveredSourceCheck({
    batchId: manifest.batch_id,
    notes: manifest.notes,
    media: manifest.media,
  })
  const fetched = new Set((await deliveredPages(client, context, principal)).keys())

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

  const delivered = (source: ProcessingSourceDto | ProcessingMediaSourceDto) => {
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

  return delivered
}

/**
 * Every citation must come from what this session was given: notes from its opening manifest,
 * media it actually fetched, inbox items of its lineage, and proposals pinned for it or its own.
 */
async function requireDeliveredSources(
  client: PoolClient,
  context: SessionToolContext,
  principal: SessionPrincipal,
  proposal: RetainedSessionProposalDto,
) {
  const manifest = principal.manifest
  const delivered = await deliveredSourcePredicate(client, context, principal)
  for (const source of proposalCitations(proposal)) {
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

/**
 * A `/7` proposal relies only on what is current: no proposal already stale, every observation
 * active and at the revision it cites (not one the operator has corrected since the session read it), and every
 * lot's observation set at the version it cites. Anything else is refused as stale, so the
 * session reads its brief again and cites the current facts. Earlier inputs keep accepting such a
 * proposal, as before.
 */
async function requireCurrentReliance(
  client: PoolClient,
  principal: SessionPrincipal,
  proposal: RetainedSessionProposalDto,
) {
  if (principal.manifest.schema_version !== 'bench-intake-input/7') {
    return
  }
  const proposals: string[] = []
  const observations: { id: string; revision: string }[] = []
  const sets: { lot: string; version: string }[] = []
  for (const source of proposal.relies_on.sources) {
    if (source.kind === 'proposal') {
      proposals.push(source.proposal_id)
    } else if (source.kind === 'evidence_observation') {
      observations.push({ id: source.evidence_observation_id, revision: source.revision })
    } else if (source.kind === 'observation_set') {
      sets.push({ lot: source.lot_id, version: source.version })
    }
  }
  // Stale, or resting on an identity whose lot no longer matches Capture, at any depth.
  if (proposals.length && (await notCurrent(client, proposals)).size) {
    refuse('stale', 'A relied-on proposal is no longer current; read your brief again and revise.')
  }
  // A suggestion isn't Capture's yet and may be dismissed, so only an active observation is current.
  const changed = await client.query(
    `SELECT 1 FROM unnest($1::uuid[], $2::bigint[]) AS cited(id, revision)
     LEFT JOIN public.capture_evidence_observation o ON o.id=cited.id
     WHERE o.id IS NULL OR o.status <> 'active' OR o.revision <> cited.revision LIMIT 1`,
    [observations.map((item) => item.id), observations.map((item) => item.revision)],
  )
  if (changed.rowCount) {
    refuse(
      'stale',
      'A relied-on observation is not active at the revision cited; read your brief again and cite its current revision.',
    )
  }
  const moved = await client.query(
    `SELECT 1 FROM public.capture_lot l
     JOIN unnest($1::uuid[], $2::bigint[]) AS cited(lot, version) ON cited.lot=l.id
     WHERE l.observation_set_version <> cited.version LIMIT 1`,
    [sets.map((item) => item.lot), sets.map((item) => item.version)],
  )
  const notes = proposal.relies_on.sources.flatMap((source) =>
    source.kind === 'note' ? [source.note_id] : [],
  )
  const replaced = await client.query(
    `SELECT 1 FROM public.media_evidence_note n
     WHERE n.id = ANY($1::uuid[]) AND EXISTS (
       SELECT 1 FROM public.media_evidence_note later
       WHERE later.batch_id=n.batch_id AND later.evidence_id=n.evidence_id AND later.revision>n.revision)
     LIMIT 1`,
    [notes],
  )
  if (replaced.rowCount) {
    refuse(
      'stale',
      'A relied-on note was replaced; read your brief again and cite the current note.',
    )
  }
  const retired = await client.query(
    'SELECT 1 FROM public.capture_lot_retirement WHERE lot_id = ANY($1::uuid[]) LIMIT 1',
    [sets.map((item) => item.lot)],
  )
  if (retired.rowCount) {
    refuse('stale', 'A relied-on lot was retired; read your brief again and cite current lots.')
  }
  if (moved.rowCount) {
    refuse(
      'stale',
      'A relied-on lot’s observations are not at the version cited; read your brief again and cite its current observation set.',
    )
  }
}

/** Whether an Examine output says what the item is: anything beyond its markings and estimate. */
function carriesIdentity(
  proposal: Extract<RetainedSessionProposalDto, { schema_version: 'examine-identity/1' }>,
) {
  return (
    proposal.candidates.length > 0 ||
    [
      proposal.maker,
      proposal.packaging,
      proposal.date_code,
      proposal.condition,
      proposal.nos_signals,
      proposal.nsn,
      proposal.match_notes,
    ].some((value) => value !== undefined)
  )
}

/**
 * A `/7` Examine identity of a lot that says what the item is, or relies on `identity`, rests on that
 * lot's observation set and relies on `identity`: otherwise it couldn't replace the one its
 * successors were queued on. Markings alone need neither.
 */
function requireOwnObservationSet(
  principal: SessionPrincipal,
  proposal: RetainedSessionProposalDto,
) {
  if (
    principal.manifest.schema_version === 'bench-intake-input/7' &&
    proposal.schema_version === 'examine-identity/1' &&
    // Anything but markings (and an estimate) says what the item is, whatever fields it names.
    (proposal.relies_on.fields.includes('identity') || carriesIdentity(proposal)) &&
    reliedObservationSet(proposal) === null
  ) {
    refuse(
      'validation_failed',
      'An identity relies on its lot’s observation set; read your brief again and cite its current observation set.',
    )
  }
}

/** Examine's markings rest on their observations, as a relied-on observation does. */
function markedObservations(proposal: RetainedSessionProposalDto) {
  if (proposal.schema_version !== 'examine-identity/1') {
    return []
  }
  return proposal.markings.map((marking) => ({
    kind: 'evidence_observation' as const,
    evidence_observation_id: marking.observation_id,
    revision: '1',
  }))
}

/**
 * Examine's markings are of its lot: each names an active observation of the lot it is about,
 * so a correction to one of them reaches the identity.
 */
async function requireOwnMarkings(
  client: PoolClient,
  batchId: string,
  proposal: RetainedSessionProposalDto,
) {
  if (proposal.schema_version !== 'examine-identity/1') {
    return
  }
  const named = proposal.markings.map((marking) => marking.observation_id)
  const members = await client.query<{ id: string }>(
    `SELECT evidence_observation_id AS id FROM public.capture_lot_evidence_observation
     WHERE batch_id=$1 AND lot_id=$2 AND status='active' AND evidence_observation_id = ANY($3::uuid[])`,
    [batchId, proposal.subject_id, named],
  )
  const active = new Set(members.rows.map((row) => row.id))
  const index = named.findIndex((id) => !active.has(id))
  if (index >= 0) {
    const reason = 'Name an active observation of this lot.'
    throw new ToolRefusal(
      'validation_failed',
      `A marking names an observation outside the lot. ${reason}`,
      [{ path: `/proposal/markings/${index}/observation_id`, rule: 'not_allowed', reason }],
    )
  }
}

/** The Processing snapshot reads at most this many proposals and questions per attempt. */
/** Half the snapshot budget, leaving room for JSON framing and the rest of the snapshot. */
const SESSION_RESULT_BUDGET_BYTES = MAX_PROCESSING_SNAPSHOT_BYTES / 2
/** A generous upper bound for the read-model fields around one proposal or question. */
const RESULT_PROJECTION_BYTES = 512

/** The read's extra fields around one question figure: its state, label and page size. */
const FIGURE_PROJECTION_BYTES = 384

async function requireRoom(
  client: PoolClient,
  principal: SessionPrincipal,
  label: 'proposals' | 'questions',
  newBytes: number,
  figures = 0,
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
      + COALESCE((SELECT sum(octet_length(q.spec_bytes)+${RESULT_PROJECTION_BYTES}+${MAX_ANSWER_SUMMARY_BYTES}) FROM public.processing_question q
        WHERE q.batch_id=$1),0)
      + COALESCE((SELECT count(*)*${FIGURE_PROJECTION_BYTES} FROM public.processing_question_figure f
        WHERE f.batch_id=$1),0))::text AS bytes`,
    [principal.batchId],
  )
  // Each question also keeps room for its answer's summary in the read.
  const allowance =
    RESULT_PROJECTION_BYTES +
    (label === 'questions' ? MAX_ANSWER_SUMMARY_BYTES : 0) +
    figures * FIGURE_PROJECTION_BYTES
  const projected = BigInt(retained.rows[0].bytes) + BigInt(newBytes + allowance)
  if (projected > BigInt(SESSION_RESULT_BUDGET_BYTES)) {
    refuse('capacity_reached', 'This batch has reached the size limit for retained results.')
  }
}

/**
 * The question an ask replaces must be this session's, unanswered and not replaced already. It is
 * locked here, after the job and attempt, so its state can't change before it closes.
 */
async function requireReplaceable(
  client: PoolClient,
  principal: SessionPrincipal,
  questionId: string,
  /** The `/7` lot the replacing ask is about, and what the replaced one was about. */
  subjects?: { asked: string | null; replaced: string | null },
) {
  const rows = await client.query<{ state: string; replaced: boolean; attempt_id: string }>(
    `SELECT q.state, q.attempt_id, EXISTS (
         SELECT 1 FROM public.processing_question_replacement r WHERE r.question_id=q.id
       ) AS replaced
       FROM public.processing_question q WHERE q.id=$1 AND q.job_id=$2 FOR UPDATE OF q`,
    [questionId, principal.jobId],
  )
  const found = rows.rows[0]
  // A `/7` replacement skips the duplicate check, so what it replaces must be open: asked by this
  // attempt, not by one a restart or Start fresh superseded.
  const stageInput = principal.manifest.schema_version === 'bench-intake-input/7'
  let reason: string | null = null
  if (!found) {
    reason = 'Name an earlier question of this session.'
  } else if (found.state === 'answered') {
    reason = 'That question is already answered; ask a new question instead.'
  } else if (found.replaced) {
    reason = 'That question was already replaced.'
  } else if (stageInput && (found.state !== 'open' || found.attempt_id !== principal.attemptId)) {
    reason = 'That question is no longer open; ask without replaces.'
  } else if (stageInput && subjects && subjects.asked !== subjects.replaced) {
    reason = 'That question is about another lot; replace only a question about this one.'
  }
  if (reason) {
    throw new ToolRefusal('validation_failed', reason, [
      { path: '/replaces', rule: 'schema', reason },
    ])
  }
}

/**
 * The question an `ask` publishes. A `/7` session may also name evidence the question rests on
 * and the conflict it settles, which the duplicate check compares and are kept beside it.
 */
function askOf(
  principal: SessionPrincipal,
  args: unknown,
): { ask: SessionAskArgsV2Dto; basis: QuestionBasis | null } {
  if (principal.manifest.schema_version !== 'bench-intake-input/7') {
    return { ask: validated<SessionAskArgsV2Dto>('SessionAskArgsV2', args), basis: null }
  }
  const {
    new_evidence: newEvidence,
    conflict,
    ...ask
  } = validated<SessionStageAskArgsDto>('SessionStageAskArgs', args)
  // Kept in a text column, which refuses NUL and unpaired surrogates.
  if (conflict !== undefined && !storableText(conflict)) {
    const reason = "The conflict holds a character that can't be stored. Remove it and retry."
    throw new ToolRefusal('validation_failed', reason, [
      {
        path: '/conflict',
        rule: 'schema',
        reason: 'Text must not hold NUL or unpaired surrogates.',
      },
    ])
  }
  return {
    ask: conflict === undefined ? ask : withConflictShown(ask, conflict),
    basis: { evidence: newEvidence ?? [], conflict: conflict ?? null },
  }
}

/** A question's reason holds at most this many characters (`ProcessingQuestionSpec`). */
const QUESTION_REASON_MAX_CHARACTERS = 2048

/**
 * The conflict that lets a question be asked again is shown to the operator with it: it closes
 * the question's reason. Too long to fit there, the ask is refused as correctable.
 */
function withConflictShown(ask: SessionAskArgsV2Dto, conflict: string): SessionAskArgsV2Dto {
  const reason = `${ask.reason}\nConflict: ${conflict}`
  if ([...reason].length > QUESTION_REASON_MAX_CHARACTERS) {
    const why = 'The reason and the conflict together are too long; shorten one.'
    throw new ToolRefusal('validation_failed', why, [
      { path: '/conflict', rule: 'maxLength', reason: why },
    ])
  }
  return { ...ask, reason }
}

/** Evidence an ask names as new must be evidence this session may fetch, not deleted. */
async function requireNamedEvidence(
  client: PoolClient,
  principal: SessionPrincipal,
  basis: QuestionBasis,
) {
  const deliverable = await deliverableVersions(client, principal)
  for (const [index, named] of basis.evidence.entries()) {
    const known = deliverable.some(
      (item) => item.evidence_id === named.evidence_id && item.version_id === named.version_id,
    )
    if (!known) {
      const reason = 'Name evidence this session may fetch.'
      throw new ToolRefusal('validation_failed', reason, [
        { path: `/new_evidence/${index}`, rule: 'not_allowed', reason },
      ])
    }
  }
  await refuseRemovedVersions(
    client,
    principal.batchId,
    basis.evidence.map((named) => named.version_id),
  )
}

/** Closes the replaced question and records which question replaced it. */
async function replaceQuestion(
  client: PoolClient,
  jobId: string,
  questionId: string,
  replacedBy: string,
) {
  await client.query(
    `INSERT INTO public.processing_question_replacement(job_id,question_id,replaced_by)
     VALUES($1,$2,$3)`,
    [jobId, questionId, replacedBy],
  )
  await executeDatabaseQuery(
    queryDatabase(client)
      .update(processingQuestions)
      .set({ state: 'superseded', revision: sql`${processingQuestions.revision}+1` })
      .where(eq(processingQuestions.id, questionId)),
  )
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
  payload: RetainedSessionProposalDto | SessionAskArgsV2Dto,
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

/** Figures must show only what this session was given; see `resolveFigures`. */
async function requireFigures(
  client: PoolClient,
  principal: SessionPrincipal,
  figures: NonNullable<SessionAskArgsV2Dto['figures']>,
  context: SessionToolContext,
): Promise<ResolvedFigure[]> {
  const delivered = await deliveredSourcePredicate(client, context, principal)
  const pages = await deliveredPages(client, context, principal)
  const resolved = await resolveFigures(client, principal.batchId, figures, {
    delivered,
    pages: (versionId) => pages.get(versionId) ?? new Set(),
  })
  if ('refusal' in resolved) {
    throw new ToolRefusal(resolved.refusal.code, resolved.refusal.message, [resolved.refusal.issue])
  }
  return resolved.figures
}

/**
 * A preview's images need the larger evidence frame. The `shared-vm-agent/1` relay doesn't
 * negotiate it, so a preview there would break its frame; it is refused before anything renders.
 */
function requirePreviewRelay(principal: SessionPrincipal) {
  if (principal.manifest.profile_id === 'shared-vm-agent/1') {
    throw new ToolRefusal(
      'validation_failed',
      'Previews are not available in this session. Ask without preview; the operator sees the pictures.',
      [
        {
          path: '/preview',
          rule: 'unsupported',
          reason: 'This session cannot receive preview images.',
        },
      ],
    )
  }
}

/** Stores a preview's marked render requests, refusing when too many are already waiting. */
async function queuePreviews(
  client: PoolClient,
  principal: SessionPrincipal,
  figures: ResolvedFigure[],
) {
  if (!figures.length) {
    throw new ToolRefusal('validation_failed', 'A preview needs at least one figure.', [
      { path: '/figures', rule: 'required', reason: 'A preview renders figures; add one.' },
    ])
  }
  const pending = await pendingPreviewCount(client, principal.lineageId!)
  if (pending + figures.length > MAX_PENDING_PREVIEWS) {
    refuse(
      'preview_busy',
      `This session already has ${pending} previews waiting to render. Wait a moment and preview again.`,
    )
  }
  return enqueueFigureRenders(
    client,
    principal.batchId,
    figures.map((item) => ({ recipe: item.recipe, marks: item.figure.marks ?? [] })),
    principal.lineageId!,
  )
}

/** Records each figure of a stored question and queues its operator view. */
async function storeQuestionFigures(
  client: PoolClient,
  principal: SessionPrincipal,
  questionId: string,
  figures: ResolvedFigure[],
) {
  if (!figures.length) {
    return
  }
  await enqueueFigureRenders(
    client,
    principal.batchId,
    figures.map((item) => ({ recipe: item.recipe })),
  )
  for (const [index, item] of figures.entries()) {
    await client.query(
      `INSERT INTO public.processing_question_figure(
         question_id, figure_index, batch_id, version_id, page, recipe_digest)
       VALUES($1,$2,$3,$4,$5,$6)`,
      [
        questionId,
        index + 1,
        principal.batchId,
        item.recipe.source_version_id,
        item.recipe.page,
        figureRecipeDigest(item.recipe),
      ],
    )
  }
}

/**
 * Polls a preview's renders until none is queued, within `FIGURE_PREVIEW_WAIT_MS`. A state read
 * after the deadline doesn't count, so a render settling late is still not ready.
 */
async function settledPreviews(context: SessionToolContext, preview: QueuedPreview) {
  const deadline = Date.now() + (context.figurePreviewWaitMs ?? FIGURE_PREVIEW_WAIT_MS)
  for (;;) {
    // The read, its connection included, gets only the time left; a late answer doesn't count.
    const state = await beforeDeadline(previewState(context, preview, deadline), deadline)
    if (state === LATE || Date.now() > deadline) {
      return 'not_ready' as const
    }
    if (!state.renders.some((render) => render.state === 'queued')) {
      return state
    }
    await delay(Math.min(FIGURE_PREVIEW_POLL_MS, deadline - Date.now()))
  }
}

/**
 * The preview's renders and, if the sweep took any, whether a photo was removed. One timer bounds
 * the reads: at the deadline it closes the connection and cancels the statement in flight on the
 * server, so no read holds a connection past the wait and none starts after it.
 */
async function previewState(context: SessionToolContext, preview: QueuedPreview, deadline: number) {
  if (Date.now() >= deadline) {
    return LATE
  }
  const client = await context.pool.connect()
  if (Date.now() >= deadline) {
    // Nothing was sent, so the connection goes back as it came.
    client.release()
    return LATE
  }
  let broken = false
  let released = false

  const onError = () => {
    broken = true
  }

  const closeAtDeadline = () => {
    released = true
    // Closing the socket frees the pool's slot, but the server keeps running a statement until it
    // next writes, so a best-effort cancel request is started before the client is discarded.
    cancelRunningStatement(context.pool, client)
    client.release(true)
  }

  // A connection lost while checked out is reported here, not to the process. A discarded
  // connection keeps the handler, since it may still report its closing.
  client.on('error', onError)
  const timer = setTimeout(closeAtDeadline, deadline - Date.now())

  const past = () => released || Date.now() >= deadline

  try {
    const renders = await previewRenders(client, preview.ids)
    if (past()) {
      return LATE
    }
    if (!renders.some((render) => render.state === 'gone')) {
      return { renders, removed: false }
    }
    const removed = await removedVersionIds(client, preview.batchId, preview.versions)
    if (past()) {
      return LATE
    }
    return { renders, removed: removed.size > 0 }
  } catch (error) {
    if (released) {
      return LATE
    }
    broken = true
    throw error
  } finally {
    clearTimeout(timer)
    if (!released) {
      released = true
      client.release(broken)
      if (!broken) {
        client.removeListener('error', onError)
      }
    }
  }
}

const LATE = Symbol('late')

/**
 * The work's result, or `LATE` once the deadline passes first. Late work is left to finish on
 * its own; its result and any failure are dropped.
 */
async function beforeDeadline<T>(work: Promise<T>, deadline: number): Promise<T | typeof LATE> {
  const remaining = deadline - Date.now()
  if (remaining <= 0) {
    work.catch(() => undefined)
    return LATE
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<typeof LATE>((resolve) => {
    timer = setTimeout(() => resolve(LATE), remaining)
  })
  try {
    return await Promise.race([work, late])
  } finally {
    clearTimeout(timer)
  }
}

/** A committed preview's render requests and the versions its figures show. */
interface QueuedPreview {
  ids: string[]
  batchId: string
  versions: string[]
}

/**
 * Waits for a committed preview's renders and returns them as images within the run's image
 * budget. A preview not rendered in time returns no images and may be called again.
 */
async function previewOutput(
  context: SessionToolContext,
  run: string,
  preview: QueuedPreview,
  asked: SessionToolOutput,
): Promise<SessionToolOutput> {
  if (!asked.result.ok) {
    return asked
  }
  const committed = asked.result
  const pending = committed.pending_inbox

  const notOk = (error: SessionToolErrorDto, message: string): SessionToolOutput => ({
    result: { ok: false, error, message, pending_inbox: pending },
  })

  const state = await settledPreviews(context, preview)
  if (state === 'not_ready') {
    return notOk(
      'preview_not_ready',
      'The preview is still being prepared. Call ask with preview: true again to see it.',
    )
  }
  const settled = state.renders
  const gone = settled.findIndex((render) => render.state === 'gone')
  // An expired preview the sweep took meanwhile is asked again; a removed photo is not.
  if (gone >= 0 && !state.removed) {
    return notOk(
      'preview_not_ready',
      'The preview expired before it could be sent. Call ask with preview: true again to see it.',
    )
  }
  if (gone >= 0) {
    return notOk(
      'media_evidence_removed',
      `Figure ${gone + 1}'s preview is gone, as when its photo is removed. Choose another source.`,
    )
  }
  const failed = settled.findIndex((render) => render.state === 'failed')
  if (failed >= 0) {
    return notOk(
      'tool_failed',
      `Figure ${failed + 1} couldn't be rendered. Choose another region or page, or ask without it.`,
    )
  }
  if (!context.store) {
    return notOk('tool_failed', 'Previews are unavailable here. Ask without preview.')
  }
  const renders = settled.filter((render): render is PreviewRow => render.state === 'ready')
  const images: DeliveredImage[] = []
  for (const render of renders) {
    const bytes = await context.store.read(render.digest!)
    const image = await boundedImage(
      bytes,
      { width: render.width!, height: render.height! },
      AGENT_IMAGE_LONG_EDGE,
      false,
    )
    if (!image) {
      return notOk(
        'validation_failed',
        'A preview picture is too large to send. Use a smaller region.',
      )
    }
    images.push(image)
  }
  const total = images.reduce((sum, image) => sum + image.bytes.length, 0)
  if (total > FIGURE_PREVIEW_MAX_BYTES) {
    return notOk(
      'validation_failed',
      'The preview pictures are too large to send together. Preview fewer figures or smaller regions.',
    )
  }
  if (!reserveImageBudget(context, run, total)) {
    return notOk(
      'capacity_reached',
      'This run has used its image budget, so the preview was not sent. Ask without preview.',
    )
  }
  return {
    result: {
      ...committed,
      preview: images.map((image, index) => ({
        figure: index + 1,
        width: image.width,
        height: image.height,
        media_type: image.mediaType,
        sha256: sha256(image.bytes).toString('hex'),
      })),
    },
    images: images.map((image) => ({
      mediaType: image.mediaType,
      base64: image.bytes.toString('base64'),
    })),
  }
}

export function sessionTools(context: SessionToolContext) {
  const writer = (principal: SessionPrincipal) => ({
    config: context.config,
    batchId: principal.batchId,
    sessionId: principal.attemptId,
  })

  /** Each lot-forming write also lands in the session's outbox, so the history shows it. */
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
    read_batch: async (token: string, args: unknown) => {
      // A `/7` lead reads its brief, which carries the batch with full readings.
      if (await hasBrief(context, token)) {
        return withBriefRead(context, token, async (client, principal) => {
          const input = validated<SessionReadBriefBatchArgsDto>('SessionReadBriefBatchArgs', args)
          const stage = stagePrincipal(principal)
          if (stage.manifest.stage !== 'examine') {
            refuse('tool_not_allowed', 'Only the batch Examine lead session reads the whole batch.')
          }
          const read = await readBriefPage(client, context.config, stage, input)
          return {
            result: await ok(client, principal, { revision: read.page.revision, brief: read.page }),
            read,
          }
        })
      }
      return withSession(context, token, { capture: false }, async (client, principal) => {
        validated('SessionReadBatchArgs', args)
        if ((principal.stage as string) !== 'examine') {
          refuse('tool_not_allowed', 'Only the batch Examine lead session reads the whole batch.')
        }
        return ok(client, principal, { batch: await leadBatchView(client, principal.batchId) })
      })
    },

    read_lot: (token: string, args: unknown) =>
      withBriefRead(context, token, async (client, principal) => {
        const input = validated<SessionReadLotArgsDto>('SessionReadLotArgs', args)
        const stage = stagePrincipal(principal)
        if (stage.manifest.stage === 'examine') {
          refuse('tool_not_allowed', 'The Examine lead session reads its brief with read_batch.')
        }
        // A session reads only the lots it serves.
        if (input.lot_id !== principal.subjectId) {
          refuse('tool_not_allowed', 'This session does not serve that lot.')
        }
        const { lot_id: _lotId, ...request } = input
        const read = await readBriefPage(client, context.config, stage, request)
        return {
          result: await ok(client, principal, { revision: read.page.revision, brief: read.page }),
          read,
        }
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
      withLeadSession(context, token, async (client, principal) => {
        const input = validated<ProposeLotArgsDto>('ProposeLotArgs', args)
        refuseStageEstimate(principal, input)
        // The reason is stored in the outbox's jsonb, which refuses NUL and unpaired surrogates.
        if (input.separation_reason !== undefined && !storableText(input.separation_reason)) {
          throw new ToolRefusal(
            'validation_failed',
            "The separation reason holds a character that can't be stored. Remove it and retry.",
            [
              {
                path: '/separation_reason',
                rule: 'schema',
                reason: 'Text must not hold NUL or unpaired surrogates.',
              },
            ],
          )
        }
        const result = await proposeLot(client, writer(principal), input)
        return outboxed(client, principal, result, (id) => ({
          kind: 'lot',
          payload: {
            lot_id: id,
            ...(result.ok && result.lotOutcome ? { outcome: result.lotOutcome } : {}),
            ...(input.separation_reason ? { separation_reason: input.separation_reason } : {}),
          },
        }))
      }),

    regroup: (token: string, args: unknown) =>
      withLeadSession(context, token, async (client, principal) => {
        const input = validated<RegroupArgsDto>('RegroupArgs', args)
        const result = await regroup(client, writer(principal), input)
        return outboxed(client, principal, result, () => ({
          kind: 'regroup',
          payload: {
            lot_ids: [...new Set(input.moves.map((move) => move.to_lot_id))],
            ...(result.ok && result.moves ? { moves: result.moves } : {}),
          },
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
      withSession(
        context,
        token,
        { capture: false, batchShare: true },
        async (client, principal) => {
          const { after_seq } = validated<{ after_seq: string }>('SessionReadInboxArgs', args)
          const read = await readSessionInbox(client, principal.lineageId!, BigInt(after_seq))
          // An open drawer or session page shows which inputs the session has read.
          if (read.advanced) {
            await appendEvent(
              client,
              await batchStream(client, principal.batchId),
              'session_changed',
              { batch_id: principal.batchId },
            )
          }
          return ok(client, principal, { items: read.items })
        },
      ),

    propose: (token: string, args: unknown) =>
      withSession(
        context,
        token,
        { capture: true, leadWriter: true },
        async (client, principal, capture, onWriter) => {
          const proposal = publishedProposal(principal, args)
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
          await requireCurrentReliance(client, principal, proposal)
          await requireOwnMarkings(client, principal.batchId, proposal)
          requireOwnObservationSet(principal, proposal)
          await refuseRemovedSources(client, principal.batchId, [
            ...proposalCitations(proposal),
            ...proposal.relies_on.sources,
            ...markedObservations(proposal),
          ])
          const estimate = leadEstimate(principal, proposal)
          if (estimate && !onWriter) {
            refuse('tool_not_allowed', 'This worker cannot write the lot’s estimate.')
          }
          // A stable `/7` identity retires the lot's earlier ones and releases their successors in
          // its own transaction, which needs the writer; without it, it isn't stored at all.
          if (
            !onWriter &&
            principal.subjectId === null &&
            principal.manifest.schema_version === 'bench-intake-input/7' &&
            proposal.schema_version === 'examine-identity/1' &&
            reliedObservationSet(proposal) !== null
          ) {
            refuse('tool_not_allowed', 'This worker cannot publish the lot’s identity.')
          }
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
          // Every `/7` identity keeps its lot as it saw it, stable or not, for the claim and Review
          // gate to compare: an identity built on it rests on that lot too.
          if (
            proposal.schema_version === 'examine-identity/1' &&
            principal.manifest.schema_version === 'bench-intake-input/7'
          ) {
            await recordIdentityBasis(
              client,
              principal.batchId,
              proposal.subject_id,
              id,
              proposal.relies_on.sources.flatMap((source) =>
                source.kind === 'observation_set' ? [source.lot_id] : [],
              ),
            )
          }
          // A stable identity from the lead session starts the lot's Research and Images. It
          // takes the media and job locks, so it runs before the estimate publishes to the stream.
          if (onWriter && principal.subjectId === null) {
            await refuseRelyingOnRetired(client, principal, proposal, id)
            await queueSuccessors(() =>
              onLeadIdentity(client, context.config, capture!.snapshot, proposal, id),
            )
          }
          // Examine's estimate reaches Review as the lot's estimated quantity, unless the
          // identity it came with is already stale (it relied on an older observation set).
          if (estimate && !(await proposalStale(client, id))) {
            await recordLotEstimate(client, writer(principal), proposal.subject_id, estimate)
          }
          await appendEvent(client, streamId, 'processing_changed', { batch_id: principal.batchId })
          return ok(client, principal, { id })
        },
      ),

    ask: async (token: string, args: unknown): Promise<SessionToolOutput> => {
      let previews: QueuedPreview | undefined
      const asked = await withSession(
        context,
        token,
        { capture: true },
        async (client, principal, capture) => {
          const { ask, basis } = askOf(principal, args)
          // Only the lead session may ask about the whole batch or another subject of it.
          const liveLots = capture!.snapshot.lots.filter((lot) => !lot.retired).map((lot) => lot.id)
          const subjects = [...liveLots, ...capture!.snapshot.parts.map((part) => part.id)]
          if (
            principal.subjectId === null
              ? ask.subject_id !== null && !subjects.includes(ask.subject_id)
              : ask.subject_id !== principal.subjectId
          ) {
            const wrongSubject = subjectRefusal(ask)
            throw new ToolRefusal('validation_failed', wrongSubject.message, [wrongSubject.issue])
          }
          const stepProblem = stepRefusal(ask, new Set(liveLots))
          if (stepProblem) {
            throw new ToolRefusal('validation_failed', stepProblem.message, [stepProblem.issue])
          }
          if (ask.replaces !== undefined) {
            await requireReplaceable(
              client,
              principal,
              ask.replaces,
              basis
                ? {
                    asked: ask.subject_id ?? principal.subjectId,
                    replaced: await questionSubject(
                      client,
                      context.config,
                      capture!.snapshot,
                      ask.replaces,
                    ),
                  }
                : undefined,
            )
          }
          const figures = ask.figures
            ? await requireFigures(client, principal, ask.figures, context)
            : []
          if (ask.preview) {
            requirePreviewRelay(principal)
            previews = {
              ids: await queuePreviews(client, principal, figures),
              batchId: principal.batchId,
              versions: figures.map((item) => item.recipe.source_version_id),
            }
            return ok(client, principal)
          }
          // A `/7` question already asked is returned, not asked again; one that names the open
          // question it replaces is a new question by definition.
          if (basis) {
            await requireNamedEvidence(client, principal, basis)
          }
          if (basis && ask.replaces === undefined) {
            // A figure of evidence the earlier question didn't show is new evidence too.
            const shown = figures.map((item) => ({
              evidence_id: item.figure.source.evidence_id,
              version_id: item.recipe.source_version_id,
            }))
            const existing = await coveringQuestion(
              client,
              context.config,
              capture!.snapshot,
              ask,
              {
                ...basis,
                evidence: [...basis.evidence, ...shown],
              },
            )
            if (existing) {
              return ok(client, principal, {
                id: existing.question.question_id,
                existing_question: existing,
              })
            }
          }
          const envelope = await sealSessionEnvelope(client, principal, 'question', ask)
          await requireRoom(
            client,
            principal,
            'questions',
            sealed(ask).bytes.length,
            figures.length,
          )
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
          if (ask.replaces !== undefined) {
            await replaceQuestion(client, principal.jobId, ask.replaces, id)
          }
          if (basis) {
            await storeQuestionBasis(client, principal.batchId, id, basis)
          }
          await storeQuestionFigures(client, principal, id, figures)
          await appendSessionOutbox(client, principal.attemptId, {
            kind: 'question',
            payload: { question_id: id },
          })
          await appendEvent(client, streamId, 'processing_changed', { batch_id: principal.batchId })
          return ok(client, principal, { id })
        },
      )
      if (!previews || !asked.result.ok) {
        return asked
      }
      return previewOutput(context, capabilityDigest(token).toString('hex'), previews, asked)
    },

    fetch_evidence: async (token: string, args: unknown): Promise<SessionToolOutput> =>
      fetchEvidenceImage(context, token, capabilityDigest(token).toString('hex'), args),
  }
}
