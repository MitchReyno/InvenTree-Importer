import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { sha256 } from '../db/authority.ts'
import { transaction } from '../db/database.ts'
import { captureInTransaction } from '../capture/repository.ts'
import { type CaptureBinding } from '../capture/model.ts'
import { prepareMediaTransaction } from './transaction.ts'
import { BlobCorruptError, BlobStore, lockBlob } from './blob-store.ts'
import { retainBlob } from './blob-reference.ts'
import { lockMediaRevision } from './commands.ts'
import { renderIsolated } from './decoder-runner.ts'
import { processMediaCommand } from './worker.ts'

/** A claim older than the decoder's outer watchdog plus grace was left by a killed worker. */
const CLAIM_EXPIRY_MS = 2 * 60 * 1000
/** Wait before attempt two, then three; a third interruption ends automatic retries. */
const BACKOFF_MS = [10 * 60 * 1000, 60 * 60 * 1000]
const MAX_ATTEMPTS = 3

export type BackfillOutcome = 'completed' | 'skipped_mismatch' | 'interrupted'

interface Candidate {
  id: string
  batch_id: string
  width: number
  height: number
  digest: string
}

interface Claim extends Candidate {
  attemptId: string
  attempt: number
}

export interface BackfillOptions {
  /** The clock for claims, expiry and backoff; tests step it past a backoff window. */
  now?: () => Date
  /** Test seam: runs after candidates are selected and before each claim. */
  beforeClaim?: () => Promise<void>
}

// Previews in the worker's scope whose dimensions call for a rendition they lack, with no
// settled or live attempt, attempts remaining and no backoff pending. Sizes follow
// renditionDimensions(): a long edge above 320, 960 or 2048 pixels.
const ELIGIBLE = `
  FROM public.media_preview p
  JOIN public.capture_batch b ON b.id = p.batch_id
  WHERE b.actor_id = $1 AND b.target_id = $2 AND b.target_context_id = $3
    AND greatest(p.width, p.height) > 320
    AND (SELECT count(*) FROM public.media_preview_rendition r WHERE r.preview_id = p.id) <
        CASE WHEN greatest(p.width, p.height) > 2048 THEN 3
             WHEN greatest(p.width, p.height) > 960 THEN 2 ELSE 1 END
    AND NOT EXISTS (SELECT 1 FROM public.media_rendition_backfill a WHERE a.preview_id = p.id
                    AND a.outcome IN ('completed', 'skipped_mismatch', 'claimed'))
    AND (SELECT count(*) FROM public.media_rendition_backfill a WHERE a.preview_id = p.id) < ${MAX_ATTEMPTS}
    AND NOT EXISTS (SELECT 1 FROM public.media_rendition_backfill a WHERE a.preview_id = p.id
                    AND a.retry_after > $4)`

const COLUMNS = `p.id, p.batch_id, p.width, p.height, encode(p.blob_digest, 'hex') AS digest`

function scope(binding: CaptureBinding, now: Date) {
  return [binding.actorId, binding.targetId, binding.targetContextId, now]
}

async function lockPreview(client: PoolClient, previewId: string) {
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtextextended('bench-media-rendition/1:' || $1, 0))`,
    [previewId],
  )
}

/** Abandoned claims settle as interrupted with the backoff their attempt number earns. */
async function recoverAbandoned(pool: Pool, binding: CaptureBinding, now: Date) {
  await transaction(pool, async (client) => {
    await prepareMediaTransaction(client)
    await client.query(
      `UPDATE public.media_rendition_backfill a
       SET outcome = 'interrupted',
           retry_after = CASE a.attempt WHEN 1 THEN $5::timestamptz + make_interval(secs => $6)
                                        WHEN 2 THEN $5::timestamptz + make_interval(secs => $7) END
       FROM public.capture_batch b
       WHERE b.id = a.batch_id AND b.actor_id = $1 AND b.target_id = $2 AND b.target_context_id = $3
         AND a.outcome = 'claimed' AND a.claimed_at < $4`,
      [
        binding.actorId,
        binding.targetId,
        binding.targetContextId,
        new Date(now.getTime() - CLAIM_EXPIRY_MS),
        now,
        BACKOFF_MS[0] / 1000,
        BACKOFF_MS[1] / 1000,
      ],
    )
  })
}

/** Serialized per preview: eligibility is rechecked under the lock before the claim inserts. */
async function claim(
  pool: Pool,
  binding: CaptureBinding,
  previewId: string,
  ownerId: string,
  now: Date,
): Promise<Claim | null> {
  return transaction(pool, async (client) => {
    await prepareMediaTransaction(client)
    await lockPreview(client, previewId)
    const rows = await client.query<Candidate>(`SELECT ${COLUMNS} ${ELIGIBLE} AND p.id = $5`, [
      ...scope(binding, now),
      previewId,
    ])
    const candidate = rows.rows[0]
    if (!candidate) {
      return null
    }
    const prior = await client.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM public.media_rendition_backfill WHERE preview_id = $1',
      [previewId],
    )
    const attempt = prior.rows[0].count + 1
    const attemptId = randomUUID()
    await client.query(
      `INSERT INTO public.media_rendition_backfill(id, batch_id, preview_id, attempt, outcome, owner_id, claimed_at)
       VALUES($1, $2, $3, $4, 'claimed', $5, $6)`,
      [attemptId, candidate.batch_id, previewId, attempt, ownerId, now],
    )
    return { ...candidate, attemptId, attempt }
  })
}

/** Settles only an attempt this owner still holds; a recovered or stale claim stays as it is. */
async function settle(
  client: PoolClient,
  held: Claim,
  ownerId: string,
  outcome: BackfillOutcome,
  now: Date,
) {
  const retryAfter =
    outcome === 'interrupted' && held.attempt < MAX_ATTEMPTS
      ? new Date(now.getTime() + BACKOFF_MS[held.attempt - 1])
      : null
  const settled = await client.query(
    `UPDATE public.media_rendition_backfill SET outcome = $3, retry_after = $4
     WHERE id = $1 AND owner_id = $2 AND outcome = 'claimed'`,
    [held.attemptId, ownerId, outcome, retryAfter],
  )
  return settled.rowCount === 1
}

async function ownedClaim(client: PoolClient, held: Claim, ownerId: string) {
  const rows = await client.query(
    `SELECT 1 FROM public.media_rendition_backfill
     WHERE id = $1 AND owner_id = $2 AND outcome = 'claimed' FOR UPDATE`,
    [held.attemptId, ownerId],
  )
  return rows.rowCount === 1
}

async function settleAlone(
  pool: Pool,
  held: Claim,
  ownerId: string,
  outcome: BackfillOutcome,
  now: Date,
) {
  await transaction(pool, async (client) => {
    await prepareMediaTransaction(client)
    await lockPreview(client, held.id)
    await settle(client, held, ownerId, outcome, now)
  })
}

/**
 * Upgrades one retained page that lacks the renditions its dimensions call for, rendering them
 * from its retained PNG inside the bounded decoder. Returns the outcome, or null when no page in
 * scope needs work. It never writes a version, preview, decode command or decode result.
 */
export async function backfillRenditions(
  pool: Pool,
  store: BlobStore,
  binding: CaptureBinding,
  image: string,
  options: BackfillOptions = {},
): Promise<BackfillOutcome | null> {
  const now = options.now ?? (() => new Date())
  const ownerId = randomUUID()
  await recoverAbandoned(pool, binding, now())
  const candidates = await pool.query<Candidate>(
    `SELECT ${COLUMNS} ${ELIGIBLE} ORDER BY p.id LIMIT 10`,
    scope(binding, now()),
  )
  for (const candidate of candidates.rows) {
    await options.beforeClaim?.()
    const held = await claim(pool, binding, candidate.id, ownerId, now())
    if (held) {
      return run(pool, store, binding, image, held, ownerId, now)
    }
  }
  return null
}

async function run(
  pool: Pool,
  store: BlobStore,
  binding: CaptureBinding,
  image: string,
  held: Claim,
  ownerId: string,
  now: () => Date,
): Promise<BackfillOutcome> {
  let bytes: Buffer
  try {
    bytes = await store.read(held.digest)
  } catch (error) {
    // Corrupt bytes are permanent; any other read failure may be an outage and is retried.
    const outcome = error instanceof BlobCorruptError ? 'skipped_mismatch' : 'interrupted'
    await settleAlone(pool, held, ownerId, outcome, now())
    return outcome
  }
  let rendered
  try {
    rendered = await renderIsolated(image, {
      version: 'media-renditions/1',
      digest: held.digest,
      bytes,
      width: held.width,
      height: held.height,
    })
  } catch {
    await settleAlone(pool, held, ownerId, 'interrupted', now())
    return 'interrupted'
  }
  if (rendered.state !== 'ready') {
    await settleAlone(pool, held, ownerId, 'skipped_mismatch', now())
    return 'skipped_mismatch'
  }
  const renditions = rendered.renditions
  return transaction(pool, async (client) => {
    await prepareMediaTransaction(client)
    await captureInTransaction(client, binding, held.batch_id)
    await lockMediaRevision(client, held.batch_id)
    await lockPreview(client, held.id)
    if (!(await ownedClaim(client, held, ownerId))) {
      // Recovered as abandoned meanwhile: publish nothing and leave the newer state alone.
      return 'interrupted'
    }
    const digests = renditions.map((item) => sha256(item.bytes).toString('hex'))
    for (const digest of [...new Set(digests)].sort()) {
      await lockBlob(client, digest)
    }
    for (const item of renditions) {
      const blob = await store.publish(client, item.bytes)
      await retainBlob(client, blob)
      await client.query(
        `INSERT INTO public.media_preview_rendition(preview_id, batch_id, size, width, height, blob_digest)
         VALUES($1, $2, $3, $4, $5, $6) ON CONFLICT (preview_id, size) DO NOTHING`,
        [
          held.id,
          held.batch_id,
          item.size,
          item.width,
          item.height,
          Buffer.from(blob.digest, 'hex'),
        ],
      )
    }
    await settle(client, held, ownerId, 'completed', now())
    return 'completed'
  })
}

export type WorkerStep = 'decoded' | BackfillOutcome | 'idle'

/**
 * One pass of the media worker. A waiting decode always runs first, so an upload waits behind at
 * most the one page backfill already in flight.
 */
export async function mediaWorkerStep(
  pool: Pool,
  store: BlobStore,
  binding: CaptureBinding,
  image: string,
  options: BackfillOptions = {},
): Promise<WorkerStep> {
  if (await processMediaCommand(pool, store, binding, image)) {
    return 'decoded'
  }
  // A failing backfill never stops decoding; a decode failure still stops the worker, as before.
  const outcome = await backfillRenditions(pool, store, binding, image, options).catch(
    () => 'interrupted' as const,
  )
  return outcome ?? 'idle'
}

/**
 * Whether the worker loop pauses before its next pass. A decode always pauses, as before, because
 * an interrupted decode still reports as decoded; only backfill progress runs straight on.
 */
export function pauseAfter(step: WorkerStep) {
  return step !== 'completed' && step !== 'skipped_mismatch'
}
