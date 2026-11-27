import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import {
  assertMediaLitViewRecipe,
  assertMediaViewMarks,
  assertMediaViewRecipe,
  type MediaLitViewRecipeDto,
  type MediaViewMarkDto,
  type MediaViewRecipeDto,
} from '@invimport/contracts/media'
import { strictJson } from '@invimport/contracts/json'
import { appendEvent, sha256, verifyBytes } from '#/db/authority.ts'
import { transaction } from '#/db/database.ts'
import { captureInTransaction } from '#/capture/repository.ts'
import type { CaptureBinding } from '#/capture/model.ts'
import { sealed } from '#/processing/model.ts'
import { BlobStore, lockBlob, MIN_GC_AGE_MS, tryLockBlob } from './blob-store.ts'
import { blobReferenced, retainBlob } from './blob-reference.ts'
import { prepareMediaTransaction } from './transaction.ts'
import { tryLockMediaRevision } from './commands.ts'
import { versionRemovedSql } from './removal.ts'
import { DecoderDispatcherBusyError } from './dispatcher-client.ts'

/** A render that fails this many times settles as failed. */
export const MAX_RENDER_ATTEMPTS = 3
/** How long a claimed render may run before another consumer may take it over. */
export const RENDER_LEASE_MS = 120_000
/** A failed attempt waits this long before it is claimed again. */
const RENDER_RETRY_DELAY_MS = 5_000
/** At most this many unsettled previews per session; beyond it a preview is refused as busy. */
export const MAX_PENDING_PREVIEWS = 20
/** Preview renders and their blobs are kept this long. */
export const PREVIEW_RETENTION_MS = 24 * 60 * 60 * 1000
/** The channel the ask transaction notifies so a waiting consumer claims at once. */
export const FIGURE_RENDER_CHANNEL = 'processing_figure_render'

/** A question figure's view recipe, or an Images crop's recipe `/2`, which has no marks. */
export type RenderRecipe = MediaViewRecipeDto | MediaLitViewRecipeDto

export type FigureRenderRequest =
  | {
      recipe: MediaViewRecipeDto
      /** Present for a marked agent preview, absent for the operator's view. */
      marks?: MediaViewMarkDto[]
    }
  | { recipe: MediaLitViewRecipeDto; marks?: undefined }

/** The recipe's digest keys a view; a preview is keyed by its marks' digest too. */
export function figureRecipeDigest(recipe: RenderRecipe) {
  return sealed(recipe).digest
}

/**
 * Stores the render requests in the caller's transaction and notifies the consumer on commit.
 * An existing request with the same key is reused, so a view shared by two questions renders once.
 * Returns each request's ID in order.
 */
export async function enqueueFigureRenders(
  client: PoolClient,
  batchId: string,
  requests: FigureRenderRequest[],
  previewFor?: string,
): Promise<string[]> {
  const ids: string[] = []
  for (const request of requests) {
    ids.push(await enqueueFigureRender(client, batchId, request, previewFor))
  }
  await client.query('SELECT pg_notify($1, $2)', [FIGURE_RENDER_CHANNEL, batchId])
  return ids
}

/**
 * A preview asked again is kept a day from now. The row lock this takes orders the ask against
 * the sweep: the sweep either deleted the old request first, so a new one is inserted, or sees
 * the new time and keeps it.
 */
const PREVIEW_ASKED_AGAIN = `ON CONFLICT (recipe_digest, marks_digest) WHERE purpose='preview'
       DO UPDATE SET requested_at=now()`

/** How many times a view's enqueue retries when the request it conflicted with is swept meanwhile. */
const ENQUEUE_ATTEMPTS = 3

/** Stores one render request, or returns the existing request for the same output. */
async function enqueueFigureRender(
  client: PoolClient,
  batchId: string,
  request: FigureRenderRequest,
  previewFor?: string,
): Promise<string> {
  const recipe = sealed(request.recipe)
  const marks = request.marks === undefined ? undefined : sealed(request.marks)
  const purpose = marks ? 'preview' : 'view'
  for (let attempt = 0; attempt < ENQUEUE_ATTEMPTS; attempt += 1) {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO public.processing_figure_render(
         id, batch_id, version_id, page, purpose, recipe_bytes, recipe_digest,
         marks_bytes, marks_digest, session_lineage_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ${purpose === 'preview' ? PREVIEW_ASKED_AGAIN : 'ON CONFLICT DO NOTHING'}
       RETURNING id`,
      [
        randomUUID(),
        batchId,
        request.recipe.source_version_id,
        request.recipe.page,
        purpose,
        recipe.bytes,
        recipe.digest,
        marks?.bytes ?? null,
        marks?.digest ?? null,
        marks ? (previewFor ?? null) : null,
      ],
    )
    if (inserted.rows[0]) {
      return inserted.rows[0].id
    }
    const existing = await client.query<{ id: string }>(
      purpose === 'view'
        ? `SELECT id FROM public.processing_figure_render
           WHERE purpose='view' AND recipe_digest=$1`
        : `SELECT id FROM public.processing_figure_render
           WHERE purpose='preview' AND recipe_digest=$1 AND marks_digest=$2`,
      purpose === 'view' ? [recipe.digest] : [recipe.digest, marks!.digest],
    )
    // The sweep can delete the conflicting request between the insert and this read.
    if (existing.rows[0]) {
      return existing.rows[0].id
    }
  }
  throw new Error('figure_render_enqueue_conflict')
}

/** How many of a session's previews are still waiting to render. */
export async function pendingPreviewCount(client: PoolClient, lineageId: string) {
  const rows = await client.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM public.processing_figure_render
     WHERE purpose='preview' AND session_lineage_id=$1 AND state='queued'`,
    [lineageId],
  )
  return rows.rows[0].count
}

export interface PreviewRow {
  id: string
  state: 'queued' | 'ready' | 'failed'
  digest: string | null
  width: number | null
  height: number | null
}

/** A preview render's state; `gone` once the sweep deleted it, as for a removed photo. */
export type SettledPreview = PreviewRow | { id: string; state: 'gone' }

/** The current state of preview renders, in the order asked. */
export async function previewRenders(client: PoolClient, ids: string[]): Promise<SettledPreview[]> {
  const rows = await client.query<PreviewRow>(
    `SELECT id, state, encode(preview_digest,'hex') AS digest,
       preview_width AS width, preview_height AS height
     FROM public.processing_figure_render WHERE id = ANY($1::uuid[])`,
    [ids],
  )
  const byId = new Map(rows.rows.map((row) => [row.id, row]))
  return ids.map((id): SettledPreview => byId.get(id) ?? { id, state: 'gone' })
}

interface ClaimedRender {
  id: string
  batch_id: string
  purpose: 'view' | 'preview'
  recipe: RenderRecipe
  marks: MediaViewMarkDto[] | null
  attempts: number
  owner: string
}

/** One rendered output the decoder returned, already checked against its header. */
export interface RenderedImage {
  bytes: Buffer
  width: number
  height: number
}

export type RenderedView =
  | { state: 'ready'; view: RenderedImage; thumb: RenderedImage; preview: RenderedImage | null }
  | { state: 'malformed' }

export interface ViewRenderInput {
  digest: string
  bytes: Buffer
  width: number
  height: number
  recipe: RenderRecipe
  /** Always null for a recipe `/2`. */
  marks: MediaViewMarkDto[] | null
}

export type RenderView = (input: ViewRenderInput) => Promise<RenderedView>

/** Queued renders in the consumer's scope whose lease is free or expired and whose photo is present. */
const CLAIMABLE = `FROM public.processing_figure_render r
       JOIN public.capture_batch b ON b.id=r.batch_id
       JOIN public.media_version v ON v.batch_id=r.batch_id AND v.id=r.version_id
       WHERE r.state='queued' AND b.actor_id=$1 AND b.target_id=$2 AND b.target_context_id=$3
         AND (r.lease_expires_at IS NULL OR r.lease_expires_at<=$4)
         AND NOT ${versionRemovedSql('v')}`

type RenderClaim = { kind: 'claimed'; render: ClaimedRender } | { kind: 'exhausted' } | null

interface CandidateRow {
  id: string
  batch_id: string
  purpose: 'view' | 'preview'
  recipe_bytes: Buffer
  recipe_digest: Buffer
  marks_bytes: Buffer | null
  marks_digest: Buffer | null
  attempts: number
}

/**
 * Claims the first claimable render in queue order that no other consumer holds; a request that
 * has used its attempts and lost its lease settles as failed instead. Removing or restoring a
 * photo holds its batch's media revision lock, so the claim takes that lock too and checks the
 * photo again under it: a photo removed before the claim is never rendered. Choosing a candidate
 * never waits: a render another consumer holds is skipped, a batch being edited is passed over
 * for the next render in another batch, and a rejected candidate's locks are released before
 * the next is tried. Settling an exhausted request as failed appends an event to the batch's
 * stream, which can wait for another writer. A render claimed before a removal may still
 * finish; the sweep returns it to the queue.
 */
async function claimRender(pool: Pool, binding: CaptureBinding, now: Date): Promise<RenderClaim> {
  return transaction(pool, async (client) => {
    await prepareMediaTransaction(client)
    const busyBatches: string[] = []
    const removedRenders: string[] = []
    // A rejected candidate is rolled back to here, releasing its row and batch locks; the one
    // savepoint serves every candidate.
    await client.query('SAVEPOINT render_candidate')
    for (;;) {
      const next = await client.query<CandidateRow>(
        `SELECT r.id, r.batch_id, r.purpose, r.recipe_bytes, r.recipe_digest, r.marks_bytes,
           r.marks_digest, r.attempts
         ${CLAIMABLE}
           AND NOT (r.batch_id = ANY($5::uuid[])) AND NOT (r.id = ANY($6::uuid[]))
         ORDER BY (r.purpose='preview') DESC, r.created_at, r.id
         LIMIT 1
         FOR UPDATE OF r SKIP LOCKED`,
        [
          binding.actorId,
          binding.targetId,
          binding.targetContextId,
          now,
          busyBatches,
          removedRenders,
        ],
      )
      const candidate = next.rows[0]
      if (!candidate) {
        return null
      }
      const batchFree = await tryLockMediaRevision(client, candidate.batch_id)
      if (!batchFree) {
        busyBatches.push(candidate.batch_id)
        await client.query('ROLLBACK TO SAVEPOINT render_candidate')
        continue
      }
      // A fresh read under the batch lock sees a removal that committed after the list was read.
      if (await renderPhotoRemoved(client, candidate.id)) {
        removedRenders.push(candidate.id)
        await client.query('ROLLBACK TO SAVEPOINT render_candidate')
        continue
      }
      return leaseCandidate(client, binding, candidate, now)
    }
  })
}

async function renderPhotoRemoved(client: PoolClient, renderId: string) {
  const rows = await client.query<{ removed: boolean }>(
    `SELECT ${versionRemovedSql('v')} AS removed
     FROM public.processing_figure_render r
     JOIN public.media_version v ON v.batch_id=r.batch_id AND v.id=r.version_id
     WHERE r.id=$1`,
    [renderId],
  )
  return rows.rows[0]?.removed !== false
}

/** Leases a locked candidate, or settles it as failed once its attempts are used up. */
async function leaseCandidate(
  client: PoolClient,
  binding: CaptureBinding,
  candidate: CandidateRow,
  now: Date,
): Promise<RenderClaim> {
  if (candidate.attempts >= MAX_RENDER_ATTEMPTS) {
    await settleFailed(client, candidate.id, candidate.batch_id, binding)
    return { kind: 'exhausted' }
  }
  const owner = randomUUID()
  await client.query(
    `UPDATE public.processing_figure_render
     SET attempts=attempts+1, lease_owner=$2, lease_expires_at=$3
     WHERE id=$1`,
    [candidate.id, owner, new Date(now.getTime() + RENDER_LEASE_MS)],
  )
  return {
    kind: 'claimed',
    render: {
      id: candidate.id,
      batch_id: candidate.batch_id,
      purpose: candidate.purpose,
      recipe: retainedRecipe(candidate.recipe_bytes, candidate.recipe_digest),
      marks: retainedMarks(candidate.marks_bytes, candidate.marks_digest),
      attempts: candidate.attempts + 1,
      owner,
    },
  }
}

function retainedRecipe(bytes: Buffer, digest: Buffer): RenderRecipe {
  verifyBytes(bytes, digest)
  const recipe = strictJson(bytes.toString('utf8'))
  if (typeof recipe === 'object' && recipe !== null && 'light' in recipe) {
    assertMediaLitViewRecipe(recipe)
    return recipe
  }
  assertMediaViewRecipe(recipe)
  return recipe
}

function retainedMarks(bytes: Buffer | null, digest: Buffer | null): MediaViewMarkDto[] | null {
  if (!bytes || !digest) {
    return null
  }
  verifyBytes(bytes, digest)
  const marks = strictJson(bytes.toString('utf8'))
  assertMediaViewMarks(marks)
  return marks
}

async function batchStream(client: PoolClient, binding: CaptureBinding, batchId: string) {
  const capture = await captureInTransaction(client, binding, batchId)
  return capture.streamId
}

async function settleFailed(
  client: PoolClient,
  id: string,
  batchId: string,
  binding: CaptureBinding,
) {
  await client.query(
    `UPDATE public.processing_figure_render
     SET state='failed', settled_at=now(), lease_owner=NULL, lease_expires_at=NULL WHERE id=$1`,
    [id],
  )
  await appendEvent(client, await batchStream(client, binding, batchId), 'processing_changed', {
    batch_id: batchId,
  })
}

/** The page preview a recipe renders from, or null when the page no longer exists. */
async function pagePreview(pool: Pool, recipe: RenderRecipe) {
  const rows = await pool.query<{ digest: string; width: number; height: number }>(
    `SELECT encode(blob_digest,'hex') AS digest, width, height FROM public.media_preview
     WHERE version_id=$1 AND page=$2`,
    [recipe.source_version_id, recipe.page],
  )
  return rows.rows[0] ?? null
}

/**
 * Publishes the outputs and settles the claim, if it is still this consumer's; otherwise nothing
 * is published.
 */
async function settleReady(
  pool: Pool,
  store: BlobStore,
  binding: CaptureBinding,
  claim: ClaimedRender,
  rendered: Extract<RenderedView, { state: 'ready' }>,
) {
  const outputs = claim.purpose === 'view' ? [rendered.view, rendered.thumb] : [rendered.preview!]
  await transaction(pool, async (client) => {
    await prepareMediaTransaction(client)
    const streamId = await batchStream(client, binding, claim.batch_id)
    // The row before its blobs, the order the sweep takes them in, so neither waits on the other.
    const owned = await client.query(
      `SELECT 1 FROM public.processing_figure_render
       WHERE id=$1 AND lease_owner=$2 AND state='queued' FOR UPDATE`,
      [claim.id, claim.owner],
    )
    // Another consumer took over the expired lease, or the sweep deleted the request.
    if (!owned.rowCount) {
      return
    }
    const digests = outputs.map((output) => sha256(output.bytes).toString('hex'))
    for (const digest of [...new Set(digests)].sort()) {
      await lockBlob(client, digest)
    }
    for (const output of outputs) {
      await retainBlob(client, await store.publish(client, output.bytes))
    }
    const settled = await client.query(
      claim.purpose === 'view'
        ? `UPDATE public.processing_figure_render
           SET state='ready', settled_at=now(), lease_owner=NULL, lease_expires_at=NULL,
             view_digest=$3, view_width=$4, view_height=$5, thumb_digest=$6
           WHERE id=$1 AND lease_owner=$2 AND state='queued'`
        : `UPDATE public.processing_figure_render
           SET state='ready', settled_at=now(), lease_owner=NULL, lease_expires_at=NULL,
             preview_digest=$3, preview_width=$4, preview_height=$5
           WHERE id=$1 AND lease_owner=$2 AND state='queued'`,
      claim.purpose === 'view'
        ? [
            claim.id,
            claim.owner,
            Buffer.from(digests[0], 'hex'),
            rendered.view.width,
            rendered.view.height,
            Buffer.from(digests[1], 'hex'),
          ]
        : [
            claim.id,
            claim.owner,
            Buffer.from(digests[0], 'hex'),
            rendered.preview!.width,
            rendered.preview!.height,
          ],
    )
    if (!settled.rowCount) {
      throw new Error('figure_render_claim_changed')
    }
    await appendEvent(client, streamId, 'processing_changed', { batch_id: claim.batch_id })
  })
}

/** A failed attempt frees its lease after a short delay, or settles once attempts are used up. */
async function settleAttemptFailed(
  pool: Pool,
  binding: CaptureBinding,
  claim: ClaimedRender,
  permanent: boolean,
  now: Date,
): Promise<'failed' | 'retrying'> {
  return transaction(pool, async (client) => {
    await prepareMediaTransaction(client)
    const owned = await client.query(
      `SELECT 1 FROM public.processing_figure_render
       WHERE id=$1 AND lease_owner=$2 AND state='queued' FOR UPDATE`,
      [claim.id, claim.owner],
    )
    // Another consumer took over the expired lease; it owns the outcome now.
    if (!owned.rowCount) {
      return 'retrying'
    }
    if (permanent || claim.attempts >= MAX_RENDER_ATTEMPTS) {
      await settleFailed(client, claim.id, claim.batch_id, binding)
      return 'failed'
    }
    await client.query(
      `UPDATE public.processing_figure_render SET lease_owner=NULL, lease_expires_at=$2
       WHERE id=$1`,
      [claim.id, new Date(now.getTime() + RENDER_RETRY_DELAY_MS)],
    )
    return 'retrying'
  })
}

/** Gives a claim back without spending its attempt, to be claimed again after the retry delay. */
async function deferClaim(pool: Pool, claim: ClaimedRender, now: Date) {
  await pool.query(
    `UPDATE public.processing_figure_render
     SET attempts=attempts-1, lease_owner=NULL, lease_expires_at=$3
     WHERE id=$1 AND lease_owner=$2 AND state='queued'`,
    [claim.id, claim.owner, new Date(now.getTime() + RENDER_RETRY_DELAY_MS)],
  )
}

export type RenderStepOutcome = 'rendered' | 'failed' | 'retrying' | 'idle'

/**
 * Claims and renders one figure request. An unreadable blob or a decoder failure is retried up to
 * the attempt limit; a decoder `malformed` result or a page that no longer exists fails at once.
 */
export async function renderFigureStep(
  pool: Pool,
  store: BlobStore,
  binding: CaptureBinding,
  render: RenderView,
  clock: () => Date = () => new Date(),
): Promise<RenderStepOutcome> {
  const claimed = await claimRender(pool, binding, clock())
  if (!claimed) {
    return 'idle'
  }
  if (claimed.kind === 'exhausted') {
    return 'failed'
  }
  const claim = claimed.render
  const page = await pagePreview(pool, claim.recipe)
  if (!page || page.width !== claim.recipe.page_width || page.height !== claim.recipe.page_height) {
    await settleAttemptFailed(pool, binding, claim, true, clock())
    return 'failed'
  }
  let rendered: RenderedView
  try {
    rendered = await render({
      digest: page.digest,
      bytes: await store.read(page.digest),
      width: page.width,
      height: page.height,
      recipe: claim.recipe,
      marks: claim.purpose === 'preview' ? (claim.marks ?? []) : null,
    })
  } catch (error) {
    // Another decode holds the dispatcher's slot: nothing ran, so no attempt is spent.
    if (error instanceof DecoderDispatcherBusyError) {
      await deferClaim(pool, claim, clock())
      return 'retrying'
    }
    // An infrastructure failure doesn't prove the request bad, so it is retried.
    return settleAttemptFailed(pool, binding, claim, false, clock())
  }
  if (rendered.state !== 'ready' || (claim.purpose === 'preview' && !rendered.preview)) {
    await settleAttemptFailed(pool, binding, claim, true, clock())
    return 'failed'
  }
  await settleReady(pool, store, binding, claim, rendered)
  return 'rendered'
}

/**
 * Records blobs whose last render reference may be gone. Each is recorded under its blob lock,
 * which collection holds while it checks references and clears the record, so a release can't
 * land between that check and the clearing and be lost. Locks are taken in digest order.
 */
async function releaseBlobs(client: PoolClient, digests: (Buffer | string | null)[]) {
  const released = new Set<string>()
  for (const digest of digests) {
    if (digest !== null) {
      released.add(typeof digest === 'string' ? digest : digest.toString('hex'))
    }
  }
  for (const digest of [...released].sort()) {
    await lockBlob(client, digest)
    await client.query(
      `INSERT INTO public.processing_figure_blob_release(digest) VALUES($1)
       ON CONFLICT DO NOTHING`,
      [Buffer.from(digest, 'hex')],
    )
  }
}

export interface SweepOutcome {
  deleted: number
  /** Removed photos' question views returned to the queue for when the photo is restored. */
  requeued: number
  collected: number
}

/** SQL true when a stored question or an Images proposal shows the view render aliased `r`. */
const VIEW_REFERENCED = `(EXISTS (
  SELECT 1 FROM public.processing_question_figure f WHERE f.recipe_digest=r.recipe_digest)
  OR EXISTS (
  SELECT 1 FROM public.processing_proposal_image i WHERE i.recipe_digest=r.recipe_digest))`

/** Views a question shows of a removed photo that still hold outputs, a lease or spent attempts. */
const REQUEUE_CANDIDATES = `FROM public.processing_figure_render r
     JOIN public.capture_batch b ON b.id=r.batch_id
     JOIN public.media_version v ON v.batch_id=r.batch_id AND v.id=r.version_id
     WHERE b.actor_id=$1 AND b.target_id=$2 AND b.target_context_id=$3
       AND r.purpose='view' AND ${VIEW_REFERENCED} AND ${versionRemovedSql('v')}
       AND (r.state<>'queued' OR r.attempts>0 OR r.lease_owner IS NOT NULL)`

/** A batch's requeue met a blob lock another transaction holds; it is left for the next sweep. */
class RequeueDeferred extends Error {
  constructor() {
    super('figure_requeue_deferred')
  }
}

/**
 * Returns each view a question shows of a removed photo in one batch to the queue, with no
 * outputs, lease or spent attempts, and gives back its blobs. The claim skips it while the photo
 * is removed, so it renders again only once the photo is restored. A view already waiting so is
 * left alone.
 *
 * Removing and restoring a photo hold its batch's media revision lock, so the views are chosen
 * under that lock and a photo restored meanwhile keeps its picture. Nothing waits while the batch
 * lock is held: a batch being edited or a render being settled is skipped, and a blob lock that
 * is taken rolls the batch back. Each is left for the next sweep.
 */
async function requeueRemovedViews(pool: Pool, binding: CaptureBinding, batchId: string) {
  try {
    return await transaction(pool, async (client) => {
      await prepareMediaTransaction(client)
      const batchFree = await tryLockMediaRevision(client, batchId)
      if (!batchFree) {
        return 0
      }
      const views = await client.query<{
        id: string
        view_digest: Buffer | null
        thumb_digest: Buffer | null
      }>(
        `SELECT r.id, r.view_digest, r.thumb_digest ${REQUEUE_CANDIDATES} AND r.batch_id=$4
         FOR UPDATE OF r SKIP LOCKED`,
        [binding.actorId, binding.targetId, binding.targetContextId, batchId],
      )
      if (!views.rowCount) {
        return 0
      }
      await client.query(
        `UPDATE public.processing_figure_render
         SET state='queued', attempts=0, lease_owner=NULL, lease_expires_at=NULL,
           settled_at=NULL, view_digest=NULL, view_width=NULL, view_height=NULL, thumb_digest=NULL
         WHERE id = ANY($1::uuid[])`,
        [views.rows.map((view) => view.id)],
      )
      const released = await tryReleaseBlobs(
        client,
        views.rows.flatMap((view) => [view.view_digest, view.thumb_digest]),
      )
      if (!released) {
        throw new RequeueDeferred()
      }
      return views.rows.length
    })
  } catch (error) {
    if (error instanceof RequeueDeferred) {
      return 0
    }
    throw error
  }
}

/** As `releaseBlobs`, but false at once, before recording anything, when a blob lock is taken. */
async function tryReleaseBlobs(client: PoolClient, digests: (Buffer | null)[]) {
  const released = new Set<string>()
  for (const digest of digests) {
    if (digest !== null) {
      released.add(digest.toString('hex'))
    }
  }
  const sorted = [...released].sort()
  for (const digest of sorted) {
    if (!(await tryLockBlob(client, digest))) {
      return false
    }
  }
  for (const digest of sorted) {
    await client.query(
      `INSERT INTO public.processing_figure_blob_release(digest) VALUES($1)
       ON CONFLICT DO NOTHING`,
      [Buffer.from(digest, 'hex')],
    )
  }
  return true
}

/**
 * Deletes preview renders older than a day, view renders no question references, and a removed
 * version's previews, releasing their blobs, as one transaction that takes no batch lock; then
 * returns removed versions' question views to the queue a batch at a time; then collects
 * released blobs that are a day old and that nothing else references.
 */
export async function sweepFigureRenders(
  pool: Pool,
  store: BlobStore,
  binding: CaptureBinding,
  clock: () => Date = () => new Date(),
): Promise<SweepOutcome> {
  const now = clock()
  const deleted = await transaction(pool, async (client) => {
    await prepareMediaTransaction(client)
    const removed = await client.query<{
      view_digest: Buffer | null
      thumb_digest: Buffer | null
      preview_digest: Buffer | null
    }>(
      `DELETE FROM public.processing_figure_render r
       USING public.capture_batch b
       WHERE b.id=r.batch_id AND b.actor_id=$1 AND b.target_id=$2 AND b.target_context_id=$3
         AND (
           (r.purpose='preview' AND r.requested_at < $4)
           OR (r.purpose='view' AND r.created_at < $4 AND NOT ${VIEW_REFERENCED})
           OR ((r.purpose='preview' OR NOT ${VIEW_REFERENCED}) AND EXISTS (
             SELECT 1 FROM public.media_version v
             WHERE v.batch_id=r.batch_id AND v.id=r.version_id AND ${versionRemovedSql('v')}))
         )
       RETURNING r.view_digest, r.thumb_digest, r.preview_digest`,
      [
        binding.actorId,
        binding.targetId,
        binding.targetContextId,
        new Date(now.getTime() - PREVIEW_RETENTION_MS),
      ],
    )
    await releaseBlobs(
      client,
      removed.rows.flatMap((row) => [row.view_digest, row.thumb_digest, row.preview_digest]),
    )
    return removed.rowCount ?? 0
  })
  const batches = await pool.query<{ batch_id: string }>(
    `SELECT DISTINCT r.batch_id ${REQUEUE_CANDIDATES} ORDER BY r.batch_id`,
    [binding.actorId, binding.targetId, binding.targetContextId],
  )
  let requeued = 0
  for (const batch of batches.rows) {
    requeued += await requeueRemovedViews(pool, binding, batch.batch_id)
  }
  const due = await pool.query<ReleasedBlob>(
    `SELECT encode(digest,'hex') AS digest, released_at::text AS released
     FROM public.processing_figure_blob_release
     WHERE released_at < $1 ORDER BY released_at LIMIT 100`,
    [new Date(now.getTime() - MIN_GC_AGE_MS)],
  )
  let collected = 0
  for (const released of due.rows) {
    if (await collectReleasedBlob(pool, store, released)) {
      collected += 1
    }
  }
  return { deleted, requeued, collected }
}

export interface ReleasedBlob {
  digest: string
  /** The release's exact time, as text, so a newer release of the digest is told apart. */
  released: string
}

/**
 * Collects one released blob under its blob lock, the lock releases are recorded under. A release
 * recorded since it was selected is left for a later sweep. A blob something references again,
 * or whose file is already gone, only clears its release; one whose file is too young keeps it. The blob's
 * `media_blob` row is immutable and stays; the archive skips such a row once its file is gone.
 */
export async function collectReleasedBlob(pool: Pool, store: BlobStore, released: ReleasedBlob) {
  const digest = Buffer.from(released.digest, 'hex')
  return transaction(pool, async (client) => {
    await prepareMediaTransaction(client)
    await lockBlob(client, released.digest)

    const clearRelease = () =>
      client.query(
        `DELETE FROM public.processing_figure_blob_release
         WHERE digest=$1 AND released_at=$2::timestamptz`,
        [digest, released.released],
      )

    const current = await client.query(
      `SELECT 1 FROM public.processing_figure_blob_release
       WHERE digest=$1 AND released_at=$2::timestamptz`,
      [digest, released.released],
    )
    if (!current.rowCount) {
      return false
    }
    if (await blobReferenced(client, released.digest)) {
      await clearRelease()
      return false
    }
    const cutoff = new Date(Date.now() - MIN_GC_AGE_MS)
    const removedFile = await store.collect(client, released.digest, cutoff, blobReferenced)
    // A file too young to collect keeps its release for a later sweep; an absent one has none.
    if (removedFile || !(await store.has(released.digest))) {
      await clearRelease()
    }
    return removedFile
  })
}
