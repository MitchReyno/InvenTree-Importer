import { readSessionFailure } from './failures.ts'
import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import {
  Id,
  schemas,
  validationIssues,
  type AgentModelCatalogRefreshDto,
  type AgentPauseUpdateDto,
  type AgentSessionQueryDto,
  type AgentSettingsUpdateDto,
  type ProviderStatusQueryDto,
} from '@invimport/contracts'
import type { ProcessingConfig } from '#/processing/attempts.ts'
import { ProcessingError } from '#/processing/model.ts'
import { readAgentSettings, saveAgentSettings } from './settings.ts'
import { listAgentSessions } from './session/sessions.ts'
import { setAllPause, setBatchPause } from './pause.ts'
import { deliverInstructions } from './instructions.ts'
import { readModelCatalog, refreshModelCatalog } from './model-catalog/api.ts'
import {
  readProviderStatus,
  workerStatusSource,
  type GuestStatusSource,
} from './provider-status.ts'

/** Refusals a reload of what is saved resolves: a conflict, or a save whose outcome is unknown. */
const RELOAD_RECOVERY = new Set(['revision_conflict', 'save_outcome_unknown'])

export function registerAgents(
  app: FastifyInstance,
  pool: Pool,
  config: ProcessingConfig,
  guestStatus: GuestStatusSource = workerStatusSource(pool, config),
) {
  app.register(async (scope) => {
    scope.setErrorHandler((error, request, reply) => {
      if (!(error instanceof ProcessingError)) {
        throw error
      }
      reply.code(error.statusCode).send({
        code: error.code,
        message: 'Agent request could not be accepted.',
        recovery: RELOAD_RECOVERY.has(error.code) ? 'refresh' : 'none',
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
      {
        schema: {
          body: schemas.AgentSettingsUpdate,
          response: { 200: schemas.AgentSettingsSaveResult },
        },
      },
      (request) => saveAgentSettings(pool, config, request.body),
    )
    scope.get<{ Querystring: ProviderStatusQueryDto }>(
      '/api/v1/agents/provider-status',
      {
        schema: {
          querystring: schemas.ProviderStatusQuery,
          response: { 200: schemas.ProviderStatus },
        },
      },
      (request) => readProviderStatus(pool, config, guestStatus, request.query.refresh === 'true'),
    )
    scope.get(
      '/api/v1/agents/models',
      { schema: { response: { 200: schemas.AgentModelCatalog } } },
      () => readModelCatalog(pool, config),
    )
    scope.post<{ Body: AgentModelCatalogRefreshDto }>(
      '/api/v1/agents/models/refresh',
      {
        schema: {
          body: schemas.AgentModelCatalogRefresh,
          response: { 202: schemas.AgentModelCatalogRefreshReceipt },
        },
      },
      async (request, reply) => {
        reply.code(202)
        return refreshModelCatalog(pool, config, request.body)
      },
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
    scope.get<{ Querystring: Record<string, unknown> }>(
      '/api/v1/agent-sessions',
      { schema: { response: { 200: schemas.AgentSessionList } } },
      (request) => listAgentSessions(pool, config, sessionQuery(request.query)),
    )
  })
}

/** The list's query as the contract allows it; a malformed cursor is refused as one. */
function sessionQuery(query: Record<string, unknown>): AgentSessionQueryDto {
  if (query.before !== undefined && validationIssues('AgentSessionCursor', query.before).length) {
    throw new ProcessingError('invalid_session_cursor', 400)
  }
  if (validationIssues('AgentSessionQuery', query).length) {
    throw new ProcessingError('invalid_session_query', 400)
  }
  return query as AgentSessionQueryDto
}
