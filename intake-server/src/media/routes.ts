import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { Pool } from 'pg'
import { Id, Revision, schemas, type MediaEditDto } from '@invimport/contracts'
import { CommandPayloadConflict } from '#/db/authority.ts'
import { bootstrap, type DevConfig } from '#/config.ts'
import { CaptureError, fail } from '#/capture/model.ts'
import { BlobStore, MAX_UPLOAD_BYTES } from './blob-store.ts'
import { mediaRepository } from './repository.ts'
import { mediaContent } from './content.ts'
import { editMedia } from './edit.ts'
import { MEDIA_RENDITION_SIZE_NAMES, type MediaRenditionSize } from '@invimport/contracts/media'

function identifier(value: unknown) {
  if (typeof value !== 'string' || !new RegExp(Id.pattern!).test(value)) {
    fail('invalid_id', 400)
  }
  return value
}

/** RFC 9110 weak comparison for GET: `*`, a list, or a `W/` tag all match the current digest. */
export function matchesEntityTag(header: string | undefined, etag: string) {
  if (!header) {
    return false
  }
  return header
    .split(',')
    .map((value) => value.trim())
    .some((value) => value === '*' || value.replace(/^W\//, '') === etag)
}

/** The optional display size; anything else is refused rather than silently served full. */
function renditionSize(request: FastifyRequest): MediaRenditionSize | 'full' {
  const size = (request.query as Record<string, unknown> | undefined)?.size
  if (size === undefined) {
    return 'full'
  }
  if (size === 'full' || MEDIA_RENDITION_SIZE_NAMES.includes(size as MediaRenditionSize)) {
    return size as MediaRenditionSize | 'full'
  }
  return fail('invalid_size', 400)
}

/** A batch holds at most 200 items, removed ones included. */
const MAX_REMOVAL_IMPACT_IDS = 200

/** Comma-separated evidence IDs, at most the batch's 200 items, each named once. */
function evidenceIdList(request: FastifyRequest) {
  const value = (request.query as Record<string, unknown> | undefined)?.evidence_ids
  const ids = typeof value === 'string' ? value.split(',') : []
  if (!ids.length || ids.length > MAX_REMOVAL_IMPACT_IDS || new Set(ids).size !== ids.length) {
    fail('invalid_id', 400)
  }
  return ids.map(identifier)
}

function parameters(request: FastifyRequest) {
  const values = request.params as Record<string, unknown>
  return { batchId: identifier(values.batchId), resourceId: values.resourceId }
}

/** Explicit private media registration. API retains originals but never launches decoders. */
export function registerMediaRoutes(
  app: FastifyInstance,
  pool: Pool,
  config: DevConfig,
  store: BlobStore,
  /** Private region-crop cache, outside the blob store; tests use a per-process temp one. */
  cropCacheDir = join(tmpdir(), `intake-region-crops-${process.pid}`),
) {
  const repository = mediaRepository(pool, config, store)
  const content = mediaContent(pool, config, store)
  const configured = bootstrap(config).status === 'configured'
  app.register(async (scope) => {
    scope.addHook('preHandler', async () => {
      if (!configured) {
        fail('setup_required', 503)
      }
    })
    scope.setErrorHandler((error, request, reply) => {
      if (!(error instanceof CaptureError) && !(error instanceof CommandPayloadConflict)) {
        throw error
      }
      const statusCode = error instanceof CommandPayloadConflict ? 409 : error.statusCode
      const code = error instanceof CommandPayloadConflict ? 'payload_conflict' : error.code
      reply.code(statusCode).send({
        code,
        message:
          code === 'lot_retired'
            ? 'This lot was split or merged. Select an active successor lot for evidence changes.'
            : 'The evidence request could not be accepted.',
        recovery: code === 'revision_conflict' ? 'refresh' : 'none',
        correlation_id: request.id,
      })
    })
    scope.addContentTypeParser(
      'application/octet-stream',
      { parseAs: 'buffer', bodyLimit: MAX_UPLOAD_BYTES },
      (_request, bytes, done) => done(null, bytes),
    )
    scope.get(
      '/api/v1/batches/:batchId/media',
      { schema: { response: { 200: schemas.MediaSnapshot } } },
      (request) => repository.snapshot(parameters(request).batchId),
    )
    scope.get(
      '/api/v1/batches/:batchId/media/removal-impact',
      { schema: { response: { 200: schemas.MediaRemovalImpact } } },
      (request) => repository.removalImpact(parameters(request).batchId, evidenceIdList(request)),
    )
    scope.post(
      '/api/v1/batches/:batchId/media/commands',
      { schema: { body: schemas.MediaEdit, response: { 200: schemas.MediaSnapshot } } },
      (request) =>
        editMedia(
          pool,
          config,
          parameters(request).batchId,
          identifier(request.headers['idempotency-key']),
          request.body as MediaEditDto,
        ),
    )
    scope.post(
      '/api/v1/batches/:batchId/media/originals',
      { bodyLimit: MAX_UPLOAD_BYTES, schema: { response: { 200: schemas.MediaReceipt } } },
      async (request) => {
        const key = identifier(request.headers['idempotency-key'])
        const revision = request.headers['x-intake-media-revision']
        const encodedLabel = request.headers['x-intake-media-label']
        if (
          typeof revision !== 'string' ||
          !new RegExp(Revision.pattern!).test(revision) ||
          BigInt(revision) > 9223372036854775807n ||
          typeof encodedLabel !== 'string' ||
          encodedLabel.length > 3072 ||
          request.headers['content-type'] !== 'application/octet-stream' ||
          !Buffer.isBuffer(request.body)
        ) {
          fail('invalid_upload', 400)
        }
        let label: string
        try {
          label = decodeURIComponent(encodedLabel)
        } catch {
          fail('invalid_upload_label', 400)
        }
        if (!label.trim() || [...label].length > 256 || /[\u0000-\u001f\u007f]/.test(label)) {
          fail('invalid_upload_label', 400)
        }
        return repository.upload(parameters(request).batchId, key, revision, label, request.body)
      },
    )

    scope.get('/api/v1/batches/:batchId/media/versions/:resourceId', async (request, reply) => {
      const { batchId, resourceId } = parameters(request)
      const versionId = identifier(resourceId)
      const bytes = await content.original(batchId, versionId)
      reply
        .header('content-security-policy', "default-src 'none'; sandbox")
        .header('cross-origin-resource-policy', 'same-origin')
        .header('content-type', 'application/octet-stream')
        .header('content-disposition', `attachment; filename="${versionId}.bin"`)
      return reply.send(bytes)
    })

    scope.get('/api/v1/batches/:batchId/media/previews/:resourceId', async (request, reply) => {
      const { batchId, resourceId } = parameters(request)
      const previewId = identifier(resourceId)
      const size = renditionSize(request)
      // Authorization runs on every request, so a 304 is only ever sent to an authorized reader.
      const preview = await content.preview(batchId, previewId, size)
      const etag = `"${preview.digest}"`
      const type = preview.rendition ? 'webp' : 'png'
      reply
        .header('content-security-policy', "default-src 'none'; sandbox")
        .header('cross-origin-resource-policy', 'same-origin')
        .header('cache-control', 'private, no-cache')
        .header('etag', etag)
      if (matchesEntityTag(request.headers['if-none-match'], etag)) {
        return reply.code(304).send()
      }
      reply
        .header('content-type', `image/${type}`)
        .header('content-disposition', `inline; filename="${previewId}-${size}.${type}"`)
      return reply.send(preview.bytes)
    })

    scope.get(
      '/api/v1/batches/:batchId/media/observations/:resourceId/crop',
      async (request, reply) => {
        const { batchId, resourceId } = parameters(request)
        const observationId = identifier(resourceId)
        const size = renditionSize(request)
        const rev = (request.query as Record<string, unknown> | undefined)?.rev
        if (
          rev !== undefined &&
          (typeof rev !== 'string' || !/^[a-f0-9-]{36}(-\d{1,9}){5}$/.test(rev))
        ) {
          fail('invalid_revision', 400)
        }
        // Authorized on every request; the ETag follows the crop bytes, so an edit revalidates.
        const crop = await content.observationCrop(
          batchId,
          observationId,
          cropCacheDir,
          size,
          rev as string | undefined,
        )
        const etag = `"${createHash('sha256').update(crop.bytes).digest('hex')}"`
        reply
          .header('content-security-policy', "default-src 'none'; sandbox")
          .header('cross-origin-resource-policy', 'same-origin')
          .header('cache-control', 'private, no-cache')
          .header('etag', etag)
        if (matchesEntityTag(request.headers['if-none-match'], etag)) {
          return reply.code(304).send()
        }
        const type = crop.mediaType === 'image/webp' ? 'webp' : 'png'
        reply
          .header('content-type', crop.mediaType)
          .header('content-disposition', `inline; filename="${observationId}-${size}.${type}"`)
        return reply.send(crop.bytes)
      },
    )
  })
}
