import { prepareMediaTransaction } from './transaction.ts'
import type { Pool } from 'pg'
import { and, eq } from 'drizzle-orm'
import { captureInTransaction, fail, type CaptureBinding } from '../capture/repository.ts'
import { executeDatabaseQuery, queryDatabase, transaction } from '../db/database.ts'
import { mediaPreviewRenditions, mediaPreviews, mediaVersions } from './schema.ts'
import { observationCropRevision, type MediaRenditionSize } from '@invimport/contracts/media'
import type { BlobStore } from './blob-store.ts'
import type { EvidenceRegionDto } from '@invimport/contracts'
import { regionCropCache } from './region-crops.ts'

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
      return rows[0].digest.toString('hex')
    })
    // Immutable retained version/preview references keep this exact blob ineligible for GC.
    return store.read(digest)
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
            .select({ digest: mediaPreviews.blobDigest })
            .from(mediaPreviews)
            .where(and(eq(mediaPreviews.id, previewId), eq(mediaPreviews.batchId, batchId))),
        )
        if (!pages.length) {
          fail('not_found', 404)
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

    /** An observation's pixel region, cut from its page preview through the private cache. */
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
        return rows.rows[0]
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
