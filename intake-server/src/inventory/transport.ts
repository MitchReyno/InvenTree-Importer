import { PositivePk } from '@invimport/contracts'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { Readable } from 'node:stream'

export interface TargetBinding {
  targetId: string
  contextId: string
}
export interface TargetProfile extends TargetBinding {
  kind: 'protected-read-only' | 'owned-disposable'
  origin: string
  protectedOrigins: readonly string[]
  credential: string
}
type ReadOperation = { kind: 'get_part' | 'get_location' | 'get_stock'; pk: string }

function origin(value: string): URL {
  const url = new URL(value)
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    !['http:', 'https:'].includes(url.protocol)
  ) {
    throw new Error('invalid_target_origin')
  }
  return url
}

function host(value: URL): string {
  // WHATWG URL validates/canonicalizes IP literals, including mapped IPv6 to hex.
  // Group loopback conservatively across address families/ports; do not resolve DNS.
  const hostname = value.hostname.replace(/\.$/, '')
  const loopback =
    hostname === 'localhost' ||
    hostname === '[::1]' ||
    /^127\.[0-9]+\.[0-9]+\.[0-9]+$/.test(hostname) ||
    /^\[::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}\]$/.test(hostname)
  return loopback ? '127.0.0.1' : hostname
}

// Fetch's HTTP 421 algorithm can replay even a POST with redirect:'manual'.
// Core http.request emits ONE request, without proxy discovery, redirects or retries.
// Keep the fetch-shaped injection seam for controlled tests, not arbitrary writer adapters.
const singleSend: typeof fetch = async (input, init) => {
  if (
    !(input instanceof URL) ||
    !init ||
    !['GET', 'POST'].includes(init.method ?? '') ||
    (init.body !== undefined && typeof init.body !== 'string')
  ) {
    throw new Error('inventory_transport_call_refused')
  }
  return new Promise<Response>((resolve, reject) => {
    const request = (input.protocol === 'https:' ? httpsRequest : httpRequest)(
      input,
      {
        method: init.method,
        headers: Object.fromEntries(new Headers(init.headers)),
        agent: false,
        signal: init.signal ?? undefined,
      },
      (message) => {
        try {
          const status = message.statusCode!
          if ([204, 205, 304].includes(status)) {
            message.resume()
          }
          resolve(
            new Response(
              [204, 205, 304].includes(status)
                ? null
                : (Readable.toWeb(message) as ReadableStream<Uint8Array>),
              { status },
            ),
          )
        } catch (error) {
          message.destroy()
          reject(error)
        }
      },
    )
    request.on('error', reject)
    request.end(init.body)
  })
}

/** Transport defense in depth, NOT approval or request-journal authority. Only T03 apply may receive this closure. */
export function inventoryTransport(input: TargetProfile, send: typeof fetch = singleSend) {
  const profile = structuredClone(input)
  const destination = origin(profile.origin)
  const protectedHosts = profile.protectedOrigins.map((value) => host(origin(value)))

  const assertBinding = (binding: TargetBinding) => {
    if (binding.targetId !== profile.targetId || binding.contextId !== profile.contextId) {
      throw new Error('target_binding_mismatch')
    }
  }

  async function request(path: string, method: 'GET' | 'POST', body?: string): Promise<Response> {
    const response = await send(new URL(path, destination), {
      method,
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
      headers: { authorization: `Token ${profile.credential}`, 'content-type': 'application/json' },
    })
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel()
      throw new Error('target_redirect_refused')
    }
    return response
  }

  return Object.freeze({
    async read(binding: TargetBinding, operation: ReadOperation) {
      assertBinding(binding)
      if (
        !operation ||
        !['get_part', 'get_location', 'get_stock'].includes(operation.kind) ||
        typeof operation.pk !== 'string' ||
        !new RegExp(PositivePk.pattern!).test(operation.pk) ||
        BigInt(operation.pk) > 9223372036854775807n
      ) {
        throw new Error('read_operation_refused')
      }
      return request(
        `/api/${operation.kind === 'get_part' ? 'part' : operation.kind === 'get_location' ? 'stock/location' : 'stock'}/${operation.pk}/`,
        'GET',
      )
    },
    async sendStock(binding: TargetBinding, retainedRequestBytes: string) {
      assertBinding(binding)
      // Literal loopback only: no DNS rebinding/aliases, proxy, LAN, public target or redirects.
      // Protected loopback aliases block the whole host, not only a spelling or port.
      if (
        profile.kind !== 'owned-disposable' ||
        !profile.protectedOrigins.length ||
        destination.protocol !== 'http:' ||
        !['127.0.0.1', '[::1]'].includes(destination.hostname) ||
        protectedHosts.includes(host(destination))
      ) {
        throw new Error('mutation_target_refused')
      }
      return request('/api/stock/', 'POST', retainedRequestBytes)
    },
  })
}
