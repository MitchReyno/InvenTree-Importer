import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { schemas } from '@invimport/contracts'
import { bootstrap, type DevConfig } from '../config.ts'
import { compatibleSchema } from './compatibility.ts'

export function registerReadiness(
  app: FastifyInstance,
  pool: Pool | undefined,
  config: DevConfig,
  media: boolean,
) {
  const configured = bootstrap(config).status === 'configured'
  app.get(
    '/api/v1/readiness',
    { schema: { response: { 200: schemas.Readiness, 503: schemas.ErrorDto } } },
    async (request, reply) => {
      let ready = false
      try {
        if (pool && configured) {
          const authority = await pool.query(
            'SELECT id FROM public.target WHERE id=$1 AND current_context_id=$2',
            [config.targetId, config.targetContextId],
          )
          ready = authority.rowCount === 1 && (await compatibleSchema(pool))
        }
      } catch {
        /* Readiness never publishes database errors or connection settings. */
      }
      if (!ready) {
        return reply.code(503).send({
          code: 'readiness_unavailable',
          message: 'Local application configuration or database version is unavailable.',
          recovery: 'wait',
          correlation_id: request.id,
        })
      }
      return reply.code(200).send({
        status: 'ready',
        api_version: 'bench-intake-app/1',
        deployment: 'restricted-local-development',
        identity: 'deferred_T11',
        research: 'unqualified',
        media: media ? 'configured' : 'disabled',
        updates: 'websocket-with-polling-fallback',
        apply: 'separately-supervised-owned-fake-only',
      })
    },
  )
}
