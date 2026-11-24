import { prepareMediaTransaction } from './transaction.ts'
import type { Pool } from 'pg'
import { and, eq } from 'drizzle-orm'
import { captureInTransaction } from '#/capture/repository.ts'
import { fail, type CaptureBinding } from '#/capture/model.ts'
import { executeDatabaseQuery, queryDatabase, transaction } from '#/db/database.ts'
import { mediaPreviewRenditions, mediaPreviews, mediaVersions } from './schema.ts'
import { observationCropRevision, type MediaRenditionSize } from '@invimport/contracts/media'
import type { BlobStore } from './blob-store.ts'
import { validate, type EvidenceRegionDto, type SessionPhotoViewDto } from '@invimport/contracts'
import sharp from 'sharp'
import { regionCropCache } from './region-crops.ts'
import { requirePresentVersion, versionRemovedSql } from './removal.ts'

/** Object authorization precedes every private-byte read; hashes are never capabilities. */
export function mediaContent(pool: Pool, binding: CaptureBinding, store: BlobStore) {
  async function lookup(batchId: string, resourceId: string, kind: 'version' | 'preview') {
    const digest = await transaction(pool, async (client) => {
      await prepareMediaTransaction(client)
      await captureInTransaction(client, binding, batchId)
      const db = queryDatabase(client)
      const rows =
        kind === 'version'
          ? await executeDatabaseQuery(
              db
                .select({ digest: mediaVersions.blobDigest })
                .from(mediaVersions)
                .where(and(eq(mediaVersions.id, resourceId), eq(mediaVersions.batchId, batchId))),
            )
          : await executeDatabaseQuery(
              db
                .select({ digest: mediaPreviews.blobDigest })
                .from(mediaPreviews)
                .where(and(eq(mediaPreviews.id, resourceId), eq(mediaPreviews.batchId, batchId))),
            )
      if (!rows.length) {
        fail('not_found', 404)
      }
      if (kind === 'version') {
        await requirePresentVersion(client, batchId, resourceId)
      }
      return rows[0].digest.toString('hex')
    })
    // Immutable retained version/preview references keep this exact blob ineligible for GC.
    return store.read(digest)
  }

  /**
   * A photo view of a session in this batch of the caller's account, with its version's page
   * preview; not found when the version was removed or the view isn't the session's.
   */
  async function photoViewSource(
    batchId: string,
    view: { jobId: string; attemptId: string; seq: string },
  ) {
    return transaction(pool, async (client) => {
      await prepareMediaTransaction(client)
      await captureInTransaction(client, binding, batchId)
      const rows = await client.query<{ payload: unknown }>(
        `SELECT o.payload FROM public.agent_session_outbox o
           JOIN public.agent_session s ON s.attempt_id=o.session_id
           JOIN public.processing_attempt a ON a.id=o.session_id
           JOIN public.processing_job j ON j.id=a.job_id
           JOIN public.command c ON c.id=a.command_id
          WHERE o.session_id=$1 AND o.seq=$2 AND o.kind='photo_view'
            AND s.session_lineage_id=$3 AND j.id=$3 AND j.batch_id=$4
            AND c.actor_id=$5 AND c.target_id=$6 AND c.target_context_id=$7`,
        [
          view.attemptId,
          view.seq,
          view.jobId,
          batchId,
          binding.actorId,
          binding.targetId,
          binding.targetContextId,
        ],
      )
      if (!rows.rows[0]) {
        fail('not_found', 404)
      }
      validate('SessionPhotoView', rows.rows[0].payload)
      const recorded = rows.rows[0].payload as SessionPhotoViewDto
      const removed = await client.query<{ removed: boolean }>(
        `SELECT ${versionRemovedSql('v')} AS removed FROM public.media_version v
          WHERE v.batch_id=$1 AND v.id=$2`,
        [batchId, recorded.version_id],
      )
      const pages = await client.query<{ id: string; width: number; height: number }>(
        `SELECT id, width, height FROM public.media_preview
          WHERE batch_id=$1 AND version_id=$2 AND page=$3`,
        [batchId, recorded.version_id, recorded.page],
      )
      if (removed.rows[0]?.removed !== false || !pages.rows[0]) {
        fail('not_found', 404)
      }
      return { recorded, preview: pages.rows[0] }
    })
  }

  return {
    original(batchId: string, versionId: string) {
      return lookup(batchId, versionId, 'version')
    },

    /**
     * A page preview at a display size. A size without a rendition, before backfill or for a
     * small page, is served by the full page; `rendition` says which bytes were returned.
     */
    async preview(batchId: string, previewId: string, size: MediaRenditionSize | 'full') {
      const found = await transaction(pool, async (client) => {
        await prepareMediaTransaction(client)
        await captureInTransaction(client, binding, batchId)
        const db = queryDatabase(client)
        const pages = await executeDatabaseQuery(
          db
            .select({ digest: mediaPreviews.blobDigest, versionId: mediaPreviews.versionId })
            .from(mediaPreviews)
            .where(and(eq(mediaPreviews.id, previewId), eq(mediaPreviews.batchId, batchId))),
        )
        if (!pages.length) {
          fail('not_found', 404)
        }
        // A removed item keeps only its thumbnail, for Deleted files and the delete dialog.
        if (size !== 'thumb') {
          await requirePresentVersion(client, batchId, pages[0].versionId)
        }
        if (size !== 'full') {
          const sized = await executeDatabaseQuery(
            db
              .select({ digest: mediaPreviewRenditions.blobDigest })
              .from(mediaPreviewRenditions)
              .where(
                and(
                  eq(mediaPreviewRenditions.previewId, previewId),
                  eq(mediaPreviewRenditions.size, size),
                ),
              ),
          )
          if (sized.length) {
            return { digest: sized[0].digest.toString('hex'), rendition: true }
          }
        }
        return { digest: pages[0].digest.toString('hex'), rendition: false }
      })
      return { ...found, bytes: await store.read(found.digest) }
    },

    /**
     * A recorded photo view recut from the same page preview and resized to the size delivered,
     * as PNG. The delivered image was encoded once more, so this is a reconstruction of it.
     */
    async photoViewCrop(
      batchId: string,
      view: { jobId: string; attemptId: string; seq: string },
      cacheDir: string,
    ) {
      const { recorded, preview } = await photoViewSource(batchId, view)

      const page = () => lookup(batchId, preview.id, 'preview')

      const region = recorded.region
      if (
        region &&
        (region.x + region.width > preview.width || region.y + region.height > preview.height)
      ) {
        // The page was re-rendered at another size; the recorded region no longer applies.
        fail('region_preview_mismatch', 409)
      }
      const cut = region
        ? (
            await regionCropCache(cacheDir).crop(
              { versionId: recorded.version_id, page: recorded.page },
              {
                kind: 'pixels',
                ...region,
                source_width: preview.width,
                source_height: preview.height,
              },
              page,
            )
          ).bytes
        : await page()
      const { width, height } = recorded.delivered
      const bytes = await sharp(cut, { limitInputPixels: false })
        .resize({ width, height, fit: 'fill' })
        .png()
        .toBuffer()
      return { bytes, mediaType: 'image/png' as const }
    },

    /**
     * A question figure's rendered view or thumbnail, under the session history's scope: the
     * question must belong to this batch's job and actor. A removed photo or an unknown figure is
     * not found; a render still queued or one that failed is a conflict naming which.
     */
    async questionFigure(
      batchId: string,
      figure: { jobId: string; questionId: string; index: number },
      size: 'view' | 'thumb',
    ) {
      const digest = await transaction(pool, async (client) => {
        await prepareMediaTransaction(client)
        await captureInTransaction(client, binding, batchId)
        const rows = await client.query<{
          removed: boolean
          state: 'queued' | 'ready' | 'failed' | null
          digest: string | null
        }>(
          `SELECT ${versionRemovedSql('v')} AS removed, r.state,
             encode(CASE WHEN $8='view' THEN r.view_digest ELSE r.thumb_digest END,'hex') AS digest
           FROM public.processing_question_figure f
           JOIN public.processing_question q ON q.id=f.question_id
           JOIN public.processing_job j ON j.id=q.job_id
           JOIN public.processing_attempt a ON a.id=q.attempt_id
           JOIN public.command c ON c.id=a.command_id
           JOIN public.media_version v ON v.batch_id=f.batch_id AND v.id=f.version_id
           LEFT JOIN public.processing_figure_render r
             ON r.purpose='view' AND r.recipe_digest=f.recipe_digest
           WHERE f.question_id=$1 AND f.figure_index=$2 AND j.id=$3 AND j.batch_id=$4
             AND c.actor_id=$5 AND c.target_id=$6 AND c.target_context_id=$7`,
          [
            figure.questionId,
            figure.index,
            figure.jobId,
            batchId,
            binding.actorId,
            binding.targetId,
            binding.targetContextId,
            size,
          ],
        )
        const found = rows.rows[0]
        if (!found || found.removed || found.state === null) {
          fail('not_found', 404)
        }
        if (found!.state === 'queued') {
          fail('figure_preparing', 409)
        }
        if (found!.state === 'failed') {
          fail('figure_render_failed', 409)
        }
        return found!.digest!
      })
      return { bytes: await store.read(digest), mediaType: 'image/webp' as const }
    },

    /**
     * An observation's region at a display size. A `rev` naming a region other than the current
     * one is refused, so a page never shows a stale crop under a new revision or vice versa.
     */
    async observationCrop(
      batchId: string,
      observationId: string,
      cacheDir: string,
      size: MediaRenditionSize | 'full' = 'full',
      rev?: string,
    ) {
      const found = await transaction(pool, async (client) => {
        await prepareMediaTransaction(client)
        await captureInTransaction(client, binding, batchId)
        const rows = await client.query<{
          version_id: string
          page: number
          region: EvidenceRegionDto
          preview_id: string | null
        }>(
          `SELECT o.evidence_version_id AS version_id,o.page,o.region,
             (SELECT p.id FROM public.media_preview p
              WHERE p.batch_id=o.batch_id AND p.version_id=o.evidence_version_id AND p.page=o.page) AS preview_id
           FROM public.capture_evidence_observation o WHERE o.batch_id=$1 AND o.id=$2`,
          [batchId, observationId],
        )
        const observation = rows.rows[0]
        if (observation) {
          await requirePresentVersion(client, batchId, observation.version_id)
        }
        return observation
      })
      if (!found || found.region.kind !== 'pixels' || !found.preview_id) {
        fail('not_found', 404)
      }
      if (
        rev !== undefined &&
        rev !== observationCropRevision(found.version_id, found.page, found.region)
      ) {
        fail('region_revision_conflict', 409)
      }
      const previewId = found.preview_id
      return regionCropCache(cacheDir).crop(
        { versionId: found.version_id, page: found.page },
        found.region,
        () => lookup(batchId, previewId, 'preview'),
        size,
      )
    },
  }
}
