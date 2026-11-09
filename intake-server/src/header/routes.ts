import type { FastifyInstance } from 'fastify'
import {
  schemas,
  type ConnectionStatusDto,
  type HeaderWorkDto,
  type HeaderWorkQueryDto,
} from '@invimport/contracts'
import { readModelError } from '../api/errors.ts'
import { bootstrap, type DevConfig } from '../config.ts'
import { connectionStatus } from './connection.ts'
import { fail } from '../capture/repository.ts'

export function registerHeader(
  app: FastifyInstance,
  config: DevConfig,
  connection: () => Promise<ConnectionStatusDto>,
  work: (batchId?: string) => Promise<HeaderWorkDto>,
) {
  const configured = bootstrap(config).status === 'configured'
  const unconfigured = connectionStatus(config, undefined)
  app.register(async (scope) => {
    scope.setErrorHandler(readModelError('Header observation is unavailable.'))
    scope.get(
      '/api/v1/connection-status',
      { schema: { response: { 200: schemas.ConnectionStatus } } },
      () => (configured ? connection() : unconfigured()),
    )
    scope.get<{ Querystring: HeaderWorkQueryDto }>(
      '/api/v1/header-work',
      { schema: { querystring: schemas.HeaderWorkQuery, response: { 200: schemas.HeaderWork } } },
      (request) => {
        if (!configured) {
          fail('setup_required', 503)
        }
        return work(request.query.batch_id)
      },
    )
  })
}
