import type { Middleware } from 'openapi-fetch'
import { clientOperations } from '../generated/operations.ts'
import { schemas, validate } from './index.ts'

type SchemaName = keyof typeof schemas

export interface ClientOperation {
  timeoutMs: number
  errorMode: 'typed' | 'setup'
  requestSchema?: SchemaName
  responseSchema: SchemaName
}

export class IntakeRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code)
  }
}

function operationFor(method: string, path: string): ClientOperation {
  const operation = clientOperations.get(`${method} ${path}`)
  if (!operation) {
    throw new Error('unregistered_client_operation')
  }

  return operation
}

/** Runtime validation remains explicit; generated TypeScript cannot validate wire data. */
export function contractMiddleware(csrfToken?: string): Middleware {
  return {
    async onRequest({ request, schemaPath }) {
      const operation = operationFor(request.method, schemaPath)
      const boundedRequest = new Request(request, {
        signal: AbortSignal.timeout(operation.timeoutMs),
      })
      if (operation.requestSchema) {
        validate(operation.requestSchema, await boundedRequest.clone().json())
        boundedRequest.headers.set('x-intake-csrf', csrfToken ?? '')
      }

      return boundedRequest
    },

    async onResponse({ request, response, schemaPath }) {
      const operation = operationFor(request.method, schemaPath)
      if (!response.ok && operation.errorMode === 'setup') {
        throw new Error('intake_request_failed')
      }

      const value: unknown = await response.clone().json()
      if (!response.ok) {
        validate('ErrorDto', value)
        // Preserve a narrow checked field without claiming a generic decoded type.
        if (
          typeof value !== 'object' ||
          value === null ||
          !('code' in value) ||
          typeof value.code !== 'string'
        ) {
          throw new Error('invalid_contract')
        }

        throw new IntakeRequestError(response.status, value.code)
      }

      validate(operation.responseSchema, value)
    },
  }
}

/** Keep the public URL/RequestInit injection seam used by existing consumers and tests. */
export function compatibleTransport(transport: typeof fetch): typeof fetch {
  return async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init)
    return transport(new URL(request.url), {
      method: request.method,
      headers: Object.fromEntries(request.headers),
      redirect: request.redirect,
      signal: request.signal,
      body: request.body ? await request.text() : undefined,
    })
  }
}

export async function successfulData<T>(operation: Promise<{ data?: T }>): Promise<T> {
  const { data } = await operation
  if (data === undefined) {
    throw new Error('invalid_contract')
  }

  return data
}
