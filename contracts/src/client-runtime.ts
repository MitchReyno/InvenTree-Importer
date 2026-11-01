import createClient from 'openapi-fetch'
import type { paths } from '../generated/api.d.ts'
import { compatibleTransport, contractMiddleware } from './client-policy.ts'

export function typedClient(baseUrl: string, transport: typeof fetch, csrfToken?: string) {
  // Preserve the original absolute API-path behavior when a caller supplies a base URL path.
  const client = createClient<paths>({
    baseUrl: new URL('/', baseUrl).href.replace(/\/$/, ''),
    redirect: 'error',
    fetch: compatibleTransport(transport),
  })
  client.use(contractMiddleware(csrfToken))

  return client
}

export function commandHeaders(key: string) {
  return { 'idempotency-key': key ?? crypto.randomUUID() }
}
