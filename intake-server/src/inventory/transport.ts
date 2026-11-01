import { PositivePk } from '@invimport/contracts'

export interface TargetBinding { targetId: string; contextId: string }
export interface TargetProfile extends TargetBinding {
  kind: 'protected-read-only' | 'owned-disposable'
  origin: string
  protectedOrigins: readonly string[]
  credential: string
}
type ReadOperation = { kind: 'get_part' | 'get_location'; pk: string }

function origin(value: string): URL {
  const url = new URL(value)
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || !['http:', 'https:'].includes(url.protocol)) throw new Error('invalid_target_origin')
  return url
}
function host(value: URL): string {
  // WHATWG URL validates/canonicalizes IP literals, including mapped IPv6 to hex.
  // Group loopback conservatively across address families/ports; do not resolve DNS.
  const hostname = value.hostname.replace(/\.$/, '')
  const loopback = hostname === 'localhost' || hostname === '[::1]'
    || /^127\.[0-9]+\.[0-9]+\.[0-9]+$/.test(hostname)
    || /^\[::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}\]$/.test(hostname)
  return loopback ? '127.0.0.1' : hostname
}
/** Transport defense in depth, NOT approval or request-journal authority. Only T03 apply may receive this closure. */
export function inventoryTransport(input: TargetProfile, send: typeof fetch = fetch) {
  const profile = structuredClone(input)
  const destination = origin(profile.origin)
  const protectedHosts = profile.protectedOrigins.map(value => host(origin(value)))
  const assertBinding = (binding: TargetBinding) => {
    if (binding.targetId !== profile.targetId || binding.contextId !== profile.contextId) throw new Error('target_binding_mismatch')
  }
  async function request(path: string, method: 'GET' | 'POST', body?: string): Promise<Response> {
    const response = await send(new URL(path, destination), {
      method, body, redirect: 'manual', signal: AbortSignal.timeout(5000),
      headers: { authorization: `Token ${profile.credential}`, 'content-type': 'application/json' },
    })
    if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); throw new Error('target_redirect_refused') }
    return response
  }
  return Object.freeze({
    async read(binding: TargetBinding, operation: ReadOperation) {
      assertBinding(binding)
      if (!operation || !['get_part', 'get_location'].includes(operation.kind) || typeof operation.pk !== 'string' || !new RegExp(PositivePk.pattern!).test(operation.pk) || BigInt(operation.pk) > 9223372036854775807n) throw new Error('read_operation_refused')
      return request(`/api/${operation.kind === 'get_part' ? 'part' : 'stock/location'}/${operation.pk}/`, 'GET')
    },
    async sendStock(binding: TargetBinding, retainedRequestBytes: string) {
      assertBinding(binding)
      // Literal loopback only: no DNS rebinding/aliases, proxy, LAN, public target or redirects.
      // Protected loopback aliases block the whole host, not only a spelling or port.
      if (profile.kind !== 'owned-disposable' || !profile.protectedOrigins.length || destination.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(destination.hostname) || protectedHosts.includes(host(destination))) throw new Error('mutation_target_refused')
      return request('/api/stock/', 'POST', retainedRequestBytes)
    },
  })
}
