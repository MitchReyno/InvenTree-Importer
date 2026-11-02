import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { Pool } from 'pg'
import {
  Id,
  schemas,
  validate,
  type CaptureEditDto,
  type CaptureObserveDto,
  type InventoryMappingDto,
} from '@invimport/contracts'
import type { DevConfig } from '../config.ts'
import { CaptureError, captureRepository, fail } from './repository.ts'

export type CaptureReadOperation=CaptureObserveDto&{includeTags?:true}
export type CaptureRead = (
  operation: CaptureReadOperation,
) => Promise<{
  label: string
  mapping?: InventoryMappingDto
  partIdentity?: { category_id: string;tags?:string[] }
}>

const resourceId = (request: FastifyRequest) => {
  const id = (request.params as { id: string }).id
  if (!new RegExp(Id.pattern!).test(id)) {
    fail('invalid_id', 400)
  }
  return id
}

const commandKey = (request: FastifyRequest) => {
  const key = request.headers['idempotency-key']
  if (typeof key !== 'string' || !new RegExp(Id.pattern!).test(key)) {
    fail('idempotency_key_required', 400)
  }
  return key
}

/** Explicit registration: no connections, discovery, identity provisioning or target writes. */
export function registerCapture(
  app: FastifyInstance,
  pool: Pool,
  config: DevConfig,
  read?: CaptureRead,
) {
  const repo = captureRepository(pool, config)
  app.register(async (scope) => {
    scope.addHook('preHandler', async () => {
      if (!config.apiKey?.trim() || config.credentialRef === 'unconfigured') {
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
    scope.get('/api/v1/batches', { schema: { response: { 200: schemas.CaptureList } } }, () =>
      repo.list(),
    )
    scope.get(
      '/api/v1/batches/:id',
      { schema: { response: { 200: schemas.CaptureSnapshot } } },
      (req) => repo.read(resourceId(req)),
    )
    scope.post<{ Body: { title: string; note: string } }>(
      '/api/v1/batches',
      { schema: { body: schemas.BatchCreate, response: { 201: schemas.CaptureSnapshot } } },
      async (req, reply) => reply.code(201).send(await repo.create(commandKey(req), req.body)),
    )
    scope.post<{ Body: CaptureEditDto }>(
      '/api/v1/batches/:id/edits',
      { schema: { body: schemas.CaptureEdit, response: { 200: schemas.CaptureSnapshot } } },
      (req) => repo.edit(resourceId(req), commandKey(req), req.body),
    )
    scope.post<{ Body: CaptureObserveDto }>(
      '/api/v1/batches/:id/observations',
      { schema: { body: schemas.CaptureObserve, response: { 201: schemas.CaptureObservation } } },
      async (req, reply) => {
        const id = resourceId(req)
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
