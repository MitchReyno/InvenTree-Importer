import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { Pool } from 'pg'
import { Id, Revision, schemas, type MediaEditDto } from '@invimport/contracts'
import { CommandPayloadConflict } from '../db/authority.ts'
import type { DevConfig } from '../config.ts'
import { CaptureError, fail } from '../capture/repository.ts'
import { BlobStore, MAX_UPLOAD_BYTES } from './blob-store.ts'
import { mediaRepository } from './repository.ts'
import { mediaContent } from './content.ts'
import { editMedia } from './edit.ts'

function identifier(value: unknown) {
  if (typeof value !== 'string' || !new RegExp(Id.pattern!).test(value)) {
    fail('invalid_id', 400)
  }
  return value
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
) {
  const repository = mediaRepository(pool, config, store)
  const content = mediaContent(pool, config, store)
  app.register(async (scope) => {
    scope.addHook('preHandler', async () => {
      if (!config.apiKey?.trim() || config.credentialRef === 'unconfigured') {
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
      const bytes = await content.preview(batchId, previewId)
      reply
        .header('content-security-policy', "default-src 'none'; sandbox")
        .header('cross-origin-resource-policy', 'same-origin')
        .header('content-type', 'image/png')
        .header('content-disposition', `inline; filename="${previewId}.png"`)
      return reply.send(bytes)
    })
  })
}
