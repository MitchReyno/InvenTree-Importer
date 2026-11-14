import type { ManualAttachmentRead } from './part-attachments.ts'
import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { schemas, type ManualScopeDto, type CaptureListQueryDto } from '@invimport/contracts'
import { pathId, commandKey } from '#/api/request.ts'
import { bootstrap } from '#/config.ts'
import { CaptureError, fail } from '#/capture/model.ts'
import type { CaptureRead } from '#/capture/routes.ts'
import type { ApprovalInput } from './approve-preparation.ts'
import type { ManualConfig } from './authority.ts'
import { manualRepository } from './repository.ts'
import type { ProcessingConfig } from '#/processing/attempts.ts'
import { inboxProjection } from '#/inbox/projection.ts'
import { registerOperatorReview } from '#/operator-review/routes.ts'

const safeCodes = new Set([
  'payload_conflict',
  'source_reserved',
  'source_history_unsettled',
  'original_contribution_already_approved',
  'create_not_recoverable',
  'retained_bytes_corrupt',
  'deployment_binding_mismatch',
  'original_source_authority_missing',
  'run_authority_missing',
  'command_authority_mismatch',
])

export function registerManual(
  app: FastifyInstance,
  pool: Pool,
  config: ManualConfig,
  read?: CaptureRead,
  attachmentRead?: ManualAttachmentRead,
  processing: ProcessingConfig = { ...config, channelSecret: '' },
) {
  const repository = manualRepository(pool, config, read, attachmentRead)
  const configured = bootstrap(config).status === 'configured'
  registerOperatorReview(app, pool, config)
  app.register(async (scope) => {
    scope.addHook('preHandler', async () => {
      if (!configured) {
        fail('setup_required', 503)
      }
    })
    scope.setErrorHandler((error, request, reply) => {
      const known = error instanceof CaptureError
      const code = error instanceof Error ? error.message : ''
      if (!known && !safeCodes.has(code)) {
        throw error
      }
      reply.code(known ? error.statusCode : 409).send({
        code: known ? error.code : code,
        message:
          code === 'revision_conflict'
            ? 'Saved state changed. Refresh before submitting this command.'
            : 'This manual command could not be accepted; inspect current review or original-run results.',
        recovery: code === 'revision_conflict' ? 'refresh' : 'review',
        correlation_id: request.id,
      })
    })
    scope.get<{ Querystring: CaptureListQueryDto }>(
      '/api/v1/inbox',
      { schema: { querystring: schemas.CaptureListQuery, response: { 200: schemas.InboxList } } },
      (request) => inboxProjection(pool, config, request.query, processing),
    )
    scope.get('/api/v1/activity', { schema: { response: { 200: schemas.ManualActivity } } }, () =>
      repository.activity(),
    )
    scope.get(
      '/api/v1/batches/:id/manual',
      { schema: { response: { 200: schemas.ManualWorkspace } } },
      (request) => repository.workspace(pathId(request)),
    )
    scope.post<{ Body: ManualScopeDto }>(
      '/api/v1/batches/:id/reviews',
      { schema: { body: schemas.ManualScope, response: { 200: schemas.ManualReviewResult } } },
      (request) => repository.review(pathId(request), commandKey(request), request.body),
    )
    scope.post<{ Body: ManualScopeDto }>(
      '/api/v1/batches/:id/preparations',
      { schema: { body: schemas.ManualScope, response: { 200: schemas.ManualPreparationResult } } },
      (request) => repository.prepare(pathId(request), commandKey(request), request.body),
    )
    scope.post<{ Body: ApprovalInput }>(
      '/api/v1/preparations/:id/approvals',
      { schema: { body: schemas.Approval, response: { 200: schemas.ManualAccepted } } },
      (request) => {
        if (pathId(request) !== request.body.preparation_id) {
          fail('approval_binding_mismatch', 409)
        }
        return repository.approve(commandKey(request), request.body)
      },
    )
    scope.get(
      '/api/v1/preparations/:id/tree',
      { schema: { response: { 200: schemas.PreparationTree } } },
      (request) => repository.tree(pathId(request)),
    )
    scope.get('/api/v1/runs/:id', { schema: { response: { 200: schemas.ManualRun } } }, (request) =>
      repository.run(pathId(request)),
    )
    for (const action of ['start', 'cancel', 'recover'] as const) {
      scope.post<{
        Body: {
          expected_run_revision: string
          operation_keys?: string[]
          attachment_keys?: string[]
        }
      }>(
        `/api/v1/runs/:id/${action}`,
        {
          schema: {
            body: action === 'recover' ? schemas.ManualRecoveryCommand : schemas.ManualRunCommand,
            response: { 200: schemas.ManualAccepted },
          },
        },
        (request) => repository.command(pathId(request), commandKey(request), request.body, action),
      )
    }
  })
}
