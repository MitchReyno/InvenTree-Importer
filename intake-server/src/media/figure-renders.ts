import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import {
  assertMediaViewMarks,
  assertMediaViewRecipe,
  type MediaViewMarkDto,
  type MediaViewRecipeDto,
} from '@invimport/contracts/media'
import { strictJson } from '@invimport/contracts/json'
import { appendEvent, sha256, verifyBytes } from '#/db/authority.ts'
import { transaction } from '#/db/database.ts'
import { captureInTransaction } from '#/capture/repository.ts'
import type { CaptureBinding } from '#/capture/model.ts'
import { sealed } from '#/processing/model.ts'
import { BlobStore, lockBlob, MIN_GC_AGE_MS } from './blob-store.ts'
import { blobReferenced, retainBlob } from './blob-reference.ts'
import { prepareMediaTransaction } from './transaction.ts'
import { versionRemovedSql } from './removal.ts'

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

export interface FigureRenderRequest {
  recipe: MediaViewRecipeDto
  /** Present for a marked agent preview, absent for the operator's view. */
  marks?: MediaViewMarkDto[]
}

/** The recipe's digest keys a view; a preview is keyed by its marks' digest too. */
export function figureRecipeDigest(recipe: MediaViewRecipeDto) {
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
    const recipe = sealed(request.recipe)
    const marks = request.marks === undefined ? undefined : sealed(request.marks)
    const purpose = marks ? 'preview' : 'view'
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO public.processing_figure_render(
         id, batch_id, version_id, page, purpose, recipe_bytes, recipe_digest,
         marks_bytes, marks_digest, session_lineage_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT DO NOTHING
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
      ids.push(inserted.rows[0].id)
      continue
    }
    const existing = await client.query<{ id: string }>(
      purpose === 'view'
        ? `SELECT id FROM public.processing_figure_render
           WHERE purpose='view' AND recipe_digest=$1`
        : `SELECT id FROM public.processing_figure_render
           WHERE purpose='preview' AND recipe_digest=$1 AND marks_digest=$2`,
      purpose === 'view' ? [recipe.digest] : [recipe.digest, marks!.digest],
    )
    ids.push(existing.rows[0].id)
  }
  await client.query('SELECT pg_notify($1, $2)', [FIGURE_RENDER_CHANNEL, batchId])
  return ids
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
export async function previewRenders(pool: Pool, ids: string[]): Promise<SettledPreview[]> {
  const rows = await pool.query<PreviewRow>(
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
  recipe: MediaViewRecipeDto
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
  recipe: MediaViewRecipeDto
  marks: MediaViewMarkDto[] | null
}

export type RenderView = (input: ViewRenderInput) => Promise<RenderedView>

/**
 * Claims the oldest queued render in the consumer's scope whose lease is free or expired; a
 * request that has used its attempts and lost its lease settles as failed instead.
 */
type RenderClaim = { kind: 'claimed'; render: ClaimedRender } | { kind: 'exhausted' } | null

async function claimRender(pool: Pool, binding: CaptureBinding, now: Date): Promise<RenderClaim> {
  return transaction(pool, async (client) => {
    await prepareMediaTransaction(client)
    const candidates = await client.query<{
      id: string
      batch_id: string
      purpose: 'view' | 'preview'
      recipe_bytes: Buffer
      recipe_digest: Buffer
      marks_bytes: Buffer | null
      marks_digest: Buffer | null
      attempts: number
    }>(
      `SELECT r.id, r.batch_id, r.purpose, r.recipe_bytes, r.recipe_digest, r.marks_bytes,
         r.marks_digest, r.attempts
       FROM public.processing_figure_render r
       JOIN public.capture_batch b ON b.id=r.batch_id
       WHERE r.state='queued' AND b.actor_id=$1 AND b.target_id=$2 AND b.target_context_id=$3
         AND (r.lease_expires_at IS NULL OR r.lease_expires_at<=$4)
       ORDER BY (r.purpose='preview') DESC, r.created_at, r.id
       LIMIT 1
       FOR UPDATE OF r SKIP LOCKED`,
      [binding.actorId, binding.targetId, binding.targetContextId, now],
    )
    const candidate = candidates.rows[0]
    if (!candidate) {
      return null
    }
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
  })
}

function retainedRecipe(bytes: Buffer, digest: Buffer): MediaViewRecipeDto {
  verifyBytes(bytes, digest)
  const recipe = strictJson(bytes.toString('utf8'))
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
async function pagePreview(pool: Pool, recipe: MediaViewRecipeDto) {
  const rows = await pool.query<{ digest: string; width: number; height: number }>(
    `SELECT encode(blob_digest,'hex') AS digest, width, height FROM public.media_preview
     WHERE version_id=$1 AND page=$2`,
    [recipe.source_version_id, recipe.page],
  )
  return rows.rows[0] ?? null
}

/**
 * Publishes the outputs and settles the claim, if it is still this consumer's; otherwise the
 * outputs are released for collection.
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
      await releaseBlobs(client, digests)
      return
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
  } catch {
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
  collected: number
}

/**
 * Deletes preview renders older than a day, view renders no question references, and every
 * render of a removed version, releasing their blobs; then collects released blobs that are a
 * day old and that nothing else references.
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
           (r.purpose='preview' AND r.created_at < $4)
           OR (r.purpose='view' AND r.created_at < $4 AND NOT EXISTS (
             SELECT 1 FROM public.processing_question_figure f WHERE f.recipe_digest=r.recipe_digest))
           OR EXISTS (
             SELECT 1 FROM public.media_version v
             WHERE v.batch_id=r.batch_id AND v.id=r.version_id AND ${versionRemovedSql('v')})
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
  const due = await pool.query<{ digest: string }>(
    `SELECT encode(digest,'hex') AS digest FROM public.processing_figure_blob_release
     WHERE released_at < $1 ORDER BY released_at LIMIT 100`,
    [new Date(now.getTime() - MIN_GC_AGE_MS)],
  )
  let collected = 0
  for (const { digest } of due.rows) {
    const done = await transaction(pool, async (client) => {
      await prepareMediaTransaction(client)
      const cutoff = new Date(Date.now() - MIN_GC_AGE_MS)
      const removedFile = await store.collect(client, digest, cutoff, blobReferenced)
      await client.query('DELETE FROM public.processing_figure_blob_release WHERE digest=$1', [
        Buffer.from(digest, 'hex'),
      ])
      return removedFile
    })
    if (done) {
      collected += 1
    }
  }
  return { deleted, collected }
}
