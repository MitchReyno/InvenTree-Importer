import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { Id, schemas, type AgentSettingsUpdateDto } from '@invimport/contracts'
import type { ProcessingConfig } from '../processing/attempts.ts'
import { ProcessingError } from '../processing/model.ts'
import { readAgentSettings, saveAgentSettings } from './settings.ts'
import { listAgentSessions } from './sessions.ts'

export function registerAgents(app: FastifyInstance, pool: Pool, config: ProcessingConfig) {
  app.register(async (scope) => {
    scope.setErrorHandler((error, request, reply) => {
      if (!(error instanceof ProcessingError)) {
        throw error
      }
      reply.code(error.statusCode).send({
        code: error.code,
        message: 'Agent request could not be accepted.',
        recovery: error.code === 'revision_conflict' ? 'refresh' : 'none',
        correlation_id: request.id,
      })
    })
    scope.get(
      '/api/v1/agent-settings',
      { schema: { response: { 200: schemas.AgentSettings } } },
      () => readAgentSettings(pool, config),
    )
    scope.put<{ Body: AgentSettingsUpdateDto }>(
      '/api/v1/agent-settings',
      { schema: { body: schemas.AgentSettingsUpdate, response: { 200: schemas.AgentSettings } } },
      (request) => saveAgentSettings(pool, config, request.body),
    )
    scope.get<{ Querystring: { before?: string } }>(
      '/api/v1/agent-sessions',
      { schema: { response: { 200: schemas.AgentSessionList } } },
      (request) => {
        const keys = Object.keys(request.query)
        if (
          keys.some((key) => key !== 'before') ||
          (request.query.before !== undefined &&
            !new RegExp(Id.pattern!).test(request.query.before))
        ) {
          throw new ProcessingError('invalid_session_cursor', 400)
        }
        return listAgentSessions(pool, config, request.query.before)
      },
    )
  })
}
