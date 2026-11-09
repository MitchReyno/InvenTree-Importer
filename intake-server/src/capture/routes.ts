import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { Pool } from 'pg'
import {
  schemas,
  type CatalogueModelDto,
  validate,
  type CaptureEditDto,
  type CaptureListQueryDto,
  type CaptureObserveDto,
  type InventoryMappingDto,
} from '@invimport/contracts'
import { pathId, commandKey } from '../api/request.ts'
import { bootstrap, type DevConfig } from '../config.ts'
import { captureRepository } from './repository.ts'
import { CaptureError, fail } from './model.ts'
import type { CatalogueReader } from './catalogue.ts'
import { requireCurrentTargetContext } from './target-context.ts'

export type CaptureReadOperation = CaptureObserveDto & { includeTags?: true }
export type CaptureRead = (operation: CaptureReadOperation) => Promise<{
  label: string
  mapping?: InventoryMappingDto
  partIdentity?: { category_id: string; tags?: string[] }
}>

const catalogueModel = (request: FastifyRequest): CatalogueModelDto => {
  const model = (request.params as { model: string }).model
  if (model !== 'location' && model !== 'supplier') {
    fail('invalid_catalogue_model', 400)
  }
  return model
}

/** Explicit registration: no connections, discovery, identity provisioning or target writes. */
export function registerCapture(
  app: FastifyInstance,
  pool: Pool,
  config: DevConfig,
  read?: CaptureRead,
  catalogue?: CatalogueReader,
) {
  const repo = captureRepository(pool, config)
  const configured = bootstrap(config).status === 'configured'

  /** Scope, archive and target-context checks all precede any catalogue traffic. */
  async function authorizeCatalogue(id: string): Promise<CatalogueReader> {
    const saved = await repo.read(id)
    if (saved.archived) {
      fail('batch_archived', 409)
    }
    await requireCurrentTargetContext(pool, config)
    if (!catalogue) {
      fail('catalogue_unavailable', 503)
    }
    return catalogue
  }

  app.register(async (scope) => {
    scope.addHook('preHandler', async () => {
      if (!configured) {
        fail('setup_required', 503)
      }
    })
    scope.setErrorHandler((error, req, reply) => {
      const conflict = error instanceof Error && error.message === 'payload_conflict'
      if (!(error instanceof CaptureError) && !conflict) {
        throw error
      }
      const code = conflict ? 'payload_conflict' : (error as CaptureError).code
      reply.code(conflict ? 409 : (error as CaptureError).statusCode).send({
        code,
        message:
          code === 'revision_conflict'
            ? 'Another client saved first. Your unsaved input has not been applied.'
            : 'Capture request could not be accepted.',
        recovery: code === 'revision_conflict' ? 'refresh' : 'none',
        correlation_id: req.id,
      })
    })
    scope.get<{ Querystring: CaptureListQueryDto }>(
      '/api/v1/batches',
      { schema: { querystring: schemas.CaptureListQuery, response: { 200: schemas.CaptureList } } },
      (req) => repo.list(req.query),
    )
    scope.get(
      '/api/v1/batches/:id',
      { schema: { response: { 200: schemas.CaptureSnapshot } } },
      (req) => repo.read(pathId(req)),
    )
    scope.post<{ Body: { title: string; note: string } }>(
      '/api/v1/batches',
      { schema: { body: schemas.BatchCreate, response: { 201: schemas.CaptureSnapshot } } },
      async (req, reply) => reply.code(201).send(await repo.create(commandKey(req), req.body)),
    )
    scope.post<{ Body: CaptureEditDto }>(
      '/api/v1/batches/:id/edits',
      { schema: { body: schemas.CaptureEdit, response: { 200: schemas.CaptureSnapshot } } },
      (req) => repo.edit(pathId(req), commandKey(req), req.body),
    )
    scope.get<{ Querystring: { q: string } }>(
      '/api/v1/batches/:id/catalogue/:model',
      {
        schema: { querystring: schemas.CatalogueQuery, response: { 200: schemas.CatalogueSearch } },
      },
      async (req) => {
        const model = catalogueModel(req)
        const reader = await authorizeCatalogue(pathId(req))
        const result = await reader.search(model, req.query.q)
        await requireCurrentTargetContext(pool, config)
        return result
      },
    )
    scope.get(
      '/api/v1/batches/:id/catalogue/:model/candidates',
      { schema: { response: { 200: schemas.CatalogueCandidates } } },
      async (req) => {
        const model = catalogueModel(req)
        const reader = await authorizeCatalogue(pathId(req))
        const result = await reader.candidates(model)
        await requireCurrentTargetContext(pool, config)
        return result
      },
    )
    scope.post<{ Body: CaptureObserveDto }>(
      '/api/v1/batches/:id/observations',
      { schema: { body: schemas.CaptureObserve, response: { 201: schemas.CaptureObservation } } },
      async (req, reply) => {
        const id = pathId(req)
        const key = commandKey(req)
        const saved = await repo.read(id) // Authorize before target traffic, not just before saving the result.
        if (saved.archived) {
          fail('batch_archived', 409)
        }
        if (!read) {
          fail('inventory_read_unavailable', 503)
        }
        const observed = await read(req.body)
        const value = {
          id: randomUUID(),
          ...req.body,
          label: observed.label,
          ...(observed.mapping ? { mapping: observed.mapping } : {}),
          target_context_id: config.targetContextId,
          observed_at: new Date().toISOString(),
        }
        validate('CaptureObservation', value)
        return reply.code(201).send(await repo.observe(id, key, value))
      },
    )
  })
}
