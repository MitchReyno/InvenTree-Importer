import { readSessionFailure } from './failures.ts'
import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import {
  Id,
  schemas,
  type AgentPauseUpdateDto,
  type AgentSettingsUpdateDto,
} from '@invimport/contracts'
import type { ProcessingConfig } from '../processing/attempts.ts'
import { ProcessingError } from '../processing/model.ts'
import { readAgentSettings, saveAgentSettings } from './settings.ts'
import { listAgentSessions } from './session/sessions.ts'
import { setAllPause, setBatchPause } from './pause.ts'
import { deliverInstructions } from './instructions.ts'

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
    scope.put<{ Body: AgentPauseUpdateDto }>(
      '/api/v1/agents/pause',
      { schema: { body: schemas.AgentPauseUpdate, response: { 200: schemas.AgentPauseAll } } },
      (request) => setAllPause(pool, config, request.body.paused),
    )
    scope.put<{ Params: { id: string }; Body: AgentPauseUpdateDto }>(
      '/api/v1/batches/:id/agents/pause',
      { schema: { body: schemas.AgentPauseUpdate, response: { 200: schemas.AgentPause } } },
      (request) => {
        if (!new RegExp(Id.pattern!).test(request.params.id)) {
          throw new ProcessingError('not_found', 404)
        }
        return setBatchPause(pool, config, request.params.id, request.body.paused)
      },
    )
    scope.post<{ Params: { id: string } }>(
      '/api/v1/batches/:id/agents/instructions',
      { schema: { response: { 200: schemas.InstructionDelivery } } },
      (request) => {
        if (!new RegExp(Id.pattern!).test(request.params.id)) {
          throw new ProcessingError('not_found', 404)
        }
        return deliverInstructions(pool, config, request.params.id)
      },
    )
    scope.get<{ Params: { attemptId: string; failureId: string } }>(
      '/api/v1/agent-sessions/:attemptId/failures/:failureId',
      {
        schema: {
          response: { 200: schemas.SessionFailure },
        },
      },
      (request) => {
        if (
          ![request.params.attemptId, request.params.failureId].every((value) =>
            new RegExp(Id.pattern!).test(value),
          )
        ) {
          throw new ProcessingError('invalid_session_failure_id', 400)
        }
        return readSessionFailure(pool, config, request.params.attemptId, request.params.failureId)
      },
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
