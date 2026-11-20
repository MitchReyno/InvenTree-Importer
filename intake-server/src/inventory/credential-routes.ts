import type { FastifyInstance } from 'fastify'
import {
  MAX_INVENTORY_TOKEN_LENGTH,
  schemas,
  type InventoryCredentialDto,
  type InventoryCredentialReplaceDto,
} from '@invimport/contracts'
import { readModelError } from '#/api/errors.ts'
import { fail } from '#/capture/model.ts'
import { readBoundedBody } from '#/capture/bounded-body.ts'
import { deleteCredential, saveCredential, SecretStoreError } from './credential-store.ts'
import type { ReadTarget } from './read-target.ts'

/**
 * The longest token with every character JSON-escaped (`"` and `\` take two bytes), plus the
 * object around it, in bytes.
 */
const CREDENTIAL_BODY_LIMIT_BYTES = MAX_INVENTORY_TOKEN_LENGTH * 2 + 64

export interface InventoryCredentialRoutes {
  secretsDir: string | undefined
  /** Absent when no read target is configured, so there is no token to replace. */
  target: Pick<ReadTarget, 'binding' | 'holder' | 'probeWith'> | undefined
  /** Refuses when the retained target context is no longer this server's. */
  fence: () => Promise<void>
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
/** Longest part list answer read while checking a token, in bytes. */
const MAX_CHECK_BODY_BYTES = 64 * 1024
/** How long the check's answer may take to arrive in full, in ms. */
const CHECK_BODY_DEADLINE_MS = 3000

/**
 * Checks before saving, with one request: a 401 or 403 is a refusal, and the token is accepted
 * only when InvenTree answers the part list in full, a 200 JSON body read within its byte limit
 * and deadline that is a paginated `{results: [...]}` or a plain list. Anything else, including
 * a body that fails part-way or echoes the token, proves nothing.
 */
async function requireAccepted(probeWith: ReadTarget['probeWith'], token: string) {
  let response
  try {
    response = await probeWith(token)
  } catch {
    fail('target_unavailable', 503)
  }
  if (response.status === 401 || response.status === 403) {
    await response.body?.cancel().catch(() => undefined)
    fail('token_refused', 422)
  }
  if (!(await answersPartList(response))) {
    fail('target_unavailable', 503)
  }
}

async function answersPartList(response: Response) {
  const json = /^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')
  if (!response.ok || !json || !response.body) {
    await response.body?.cancel().catch(() => undefined)
    return false
  }
  try {
    const bytes = await readBoundedBody(response.body, MAX_CHECK_BODY_BYTES, CHECK_BODY_DEADLINE_MS)
    const body: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    const paginated =
      body !== null &&
      typeof body === 'object' &&
      Array.isArray((body as { results?: unknown }).results)
    return Array.isArray(body) || paginated
  } catch {
    return false
  }
}

/** Write-only replacement of the InvenTree read token. No response or error carries a token. */
export function registerInventoryCredential(
  app: FastifyInstance,
  routes: InventoryCredentialRoutes,
) {
  // One change at a time; another arriving meanwhile is refused rather than queued past its
  // caller's deadline.
  let changing = false

  async function exclusive<T>(run: () => Promise<T>): Promise<T> {
    if (changing) {
      fail('credential_change_in_progress', 409)
    }
    changing = true
    try {
      return await run()
    } finally {
      changing = false
    }
  }

  function requireTarget() {
    if (!routes.target) {
      fail('setup_required', 503)
    }
    return routes.target
  }

  async function replace(token: string): Promise<InventoryCredentialDto> {
    const { holder, binding, probeWith } = requireTarget()
    if (!routes.secretsDir) {
      fail('secret_store_unavailable', 503)
    }
    await routes.fence()
    await requireAccepted(probeWith, token)
    // The context may have rotated while InvenTree answered.
    await routes.fence()
    const saved = await storing(() => saveCredential(routes.secretsDir, token, binding))
    holder.replace(saved)
    routes.changed()
    return holder.state()
  }

  async function revert(): Promise<InventoryCredentialDto> {
    const { holder } = requireTarget()
    await routes.fence()
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
