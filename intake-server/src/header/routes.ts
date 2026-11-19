import type { FastifyInstance } from 'fastify'
import {
  schemas,
  type ConnectionStatusDto,
  type HeaderWorkDto,
  type HeaderWorkQueryDto,
  type InventoryCredentialDto,
} from '@invimport/contracts'
import { readModelError } from '#/api/errors.ts'
import { bootstrap, type DevConfig } from '#/config.ts'
import { connectionStatus, type ConnectionStatusReader } from './connection.ts'
import { fail } from '#/capture/model.ts'

export function registerHeader(
  app: FastifyInstance,
  config: DevConfig,
  connection: ConnectionStatusReader,
  work: (batchId?: string) => Promise<HeaderWorkDto>,
  /** Which read token is in use; shown beside a configured target, never the token. */
  credential?: () => InventoryCredentialDto,
) {
  const configured = bootstrap(config).status === 'configured'
  const unconfigured = connectionStatus(config, undefined)

  async function observed(read: () => Promise<ConnectionStatusDto>) {
    const status = await read()
    if (!credential || status.target.state === 'unconfigured') {
      return status
    }
    return { ...status, target: { ...status.target, ...credential() } }
  }

  app.register(async (scope) => {
    scope.setErrorHandler(readModelError('Header observation is unavailable.'))
    scope.get(
      '/api/v1/connection-status',
      { schema: { response: { 200: schemas.ConnectionStatus } } },
      () => (configured ? observed(connection) : unconfigured()),
    )
    // A command, not a GET flag, so a cache refetch can never force probes.
    scope.post(
      '/api/v1/connection-status/check',
      { schema: { response: { 200: schemas.ConnectionStatus } } },
      () => (configured ? observed(connection.check) : unconfigured()),
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
