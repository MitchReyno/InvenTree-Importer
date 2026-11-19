import type { FastifyInstance } from 'fastify'
import {
  schemas,
  type InventoryCredentialDto,
  type InventoryCredentialReplaceDto,
} from '@invimport/contracts'
import { readModelError } from '#/api/errors.ts'
import { fail } from '#/capture/model.ts'
import { probeResult } from '#/header/connection.ts'
import type { CredentialHolder } from './credential.ts'
import { deleteCredential, saveCredential, SecretStoreError } from './credential-store.ts'

/** Room for the longest token plus its JSON wrapping, in bytes. */
const CREDENTIAL_BODY_LIMIT_BYTES = 8192

export interface InventoryCredentialRoutes {
  secretsDir: string | undefined
  /** Absent when no read target is configured, so there is no token to replace. */
  holder: CredentialHolder | undefined
  /** Sends the connection probe with a candidate token instead of the one in use. */
  probeWith: (token: string) => Promise<Response>
  /** Runs after the token in use changes, so no observation of the old one survives. */
  changed: () => void
}

/** Turns a store failure into its response; anything else stays an internal error. */
async function storing<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof SecretStoreError) {
      fail(error.code, 503)
    }
    throw error
  }
}

/** Probes before saving: only a token InvenTree accepts is written. */
async function requireAccepted(probeWith: InventoryCredentialRoutes['probeWith'], token: string) {
  const outcome = await probeResult(() => probeWith(token))
  if (outcome.failure_code === 'unauthorized') {
    fail('token_refused', 422)
  }
  if (outcome.state !== 'reachable') {
    fail('target_unavailable', 503)
  }
}

/** Write-only replacement of the InvenTree read token. No response or error carries a token. */
export function registerInventoryCredential(
  app: FastifyInstance,
  routes: InventoryCredentialRoutes,
) {
  // One change at a time, so a replace and a revert can't interleave their file and holder updates.
  let latest: Promise<unknown> = Promise.resolve()

  function exclusive<T>(run: () => Promise<T>): Promise<T> {
    const next = latest.then(run, run)
    latest = next.catch(() => undefined)
    return next
  }

  function requireHolder(): CredentialHolder {
    if (!routes.holder) {
      fail('setup_required', 503)
    }
    return routes.holder
  }

  async function replace(token: string): Promise<InventoryCredentialDto> {
    const holder = requireHolder()
    if (!routes.secretsDir) {
      fail('secret_store_unavailable', 503)
    }
    await requireAccepted(routes.probeWith, token)
    const saved = await storing(() => saveCredential(routes.secretsDir, token))
    holder.replace(saved)
    routes.changed()
    return holder.state()
  }

  async function revert(): Promise<InventoryCredentialDto> {
    const holder = requireHolder()
    await storing(() => deleteCredential(routes.secretsDir))
    holder.revert()
    routes.changed()
    return holder.state()
  }

  app.register(async (scope) => {
    scope.setErrorHandler(readModelError('The read token could not be changed.'))
    scope.put<{ Body: InventoryCredentialReplaceDto }>(
      '/api/v1/inventory-credential',
      {
        bodyLimit: CREDENTIAL_BODY_LIMIT_BYTES,
        schema: {
          body: schemas.InventoryCredentialReplace,
          response: { 200: schemas.InventoryCredential },
        },
      },
      (request) => exclusive(() => replace(request.body.token)),
    )
    scope.delete(
      '/api/v1/inventory-credential',
      { schema: { response: { 200: schemas.InventoryCredential } } },
      () => exclusive(revert),
    )
  })
}
