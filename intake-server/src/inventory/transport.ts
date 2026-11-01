import { Digest, Id, PositivePk } from '@invimport/contracts'
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
  attachmentCapability?: 'owned-fake-media/1'
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
    (init.body !== undefined && typeof init.body !== 'string' && !(init.body instanceof Uint8Array))
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

  async function request(
    path: string,
    method: 'GET' | 'POST',
    body?: string | Uint8Array<ArrayBuffer>,
    headers: Record<string, string> = {},
  ): Promise<Response> {
    const response = await send(new URL(path, destination), {
      method,
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
      headers: {
        authorization: `Token ${profile.credential}`,
        'content-type': 'application/json',
        ...headers,
      },
    })
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel()
      throw new Error('target_redirect_refused')
    }
    return response
  }

  function requireOwnedMutationTarget() {
    const literalLoopback =
      destination.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(destination.hostname)
    const protectedDestination = protectedHosts.includes(host(destination))
    if (
      profile.kind !== 'owned-disposable' ||
      !profile.protectedOrigins.length ||
      !literalLoopback ||
      protectedDestination
    ) {
      throw new Error('mutation_target_refused')
    }
  }

  function requireOwnedMedia(binding: TargetBinding) {
    assertBinding(binding)
    requireOwnedMutationTarget()
    if (profile.attachmentCapability !== 'owned-fake-media/1') {
      throw new Error('attachment_capability_refused')
    }
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
      requireOwnedMutationTarget()
      return request('/api/stock/', 'POST', retainedRequestBytes)
    },

    async sendAttachment(binding: TargetBinding, metadata: AttachmentWire, bytes: Buffer) {
      requireOwnedMedia(binding)
      checkedAttachmentWire(metadata, bytes)
      return request('/api/stock/attachment/', 'POST', new Uint8Array(bytes), {
        'content-type': 'application/octet-stream',
        'x-bench-artifact': metadata.artifactKey,
        'x-bench-stock': metadata.stockPk,
        'x-bench-sha256': metadata.digest,
        'x-bench-byte-size': metadata.byteSize,
        'x-bench-media-type': metadata.mediaType,
      })
    },

    async readAttachment(binding: TargetBinding, operation: AttachmentRead) {
      requireOwnedMedia(binding)
      if (operation.kind === 'lookup_attachment') {
        if (!new RegExp(Id.pattern!).test(operation.artifactKey)) {
          throw new Error('attachment_read_refused')
        }
        return request(`/api/stock/attachment/artifact/${operation.artifactKey}/`, 'GET')
      }
      if (
        !new RegExp(PositivePk.pattern!).test(operation.pk) ||
        BigInt(operation.pk) > 9223372036854775807n
      ) {
        throw new Error('attachment_read_refused')
      }
      const suffix = operation.kind === 'download_attachment' ? 'download/' : ''
      if (!['get_attachment', 'download_attachment'].includes(operation.kind)) {
        throw new Error('attachment_read_refused')
      }
      return request(`/api/stock/attachment/${operation.pk}/${suffix}`, 'GET')
    },
  })
}

export interface AttachmentWire {
  artifactKey: string
  stockPk: string
  digest: string
  byteSize: string
  mediaType: 'image/jpeg' | 'image/png' | 'application/pdf'
}

export type AttachmentRead =
  | { kind: 'lookup_attachment'; artifactKey: string }
  | { kind: 'get_attachment' | 'download_attachment'; pk: string }

function checkedAttachmentWire(metadata: AttachmentWire, bytes: Buffer) {
  const validIdentity =
    new RegExp(Id.pattern!).test(metadata.artifactKey) &&
    new RegExp(PositivePk.pattern!).test(metadata.stockPk) &&
    BigInt(metadata.stockPk) <= 9223372036854775807n
  const validBytes =
    bytes.length > 0 &&
    bytes.length <= 20 * 1024 * 1024 &&
    metadata.byteSize === String(bytes.length) &&
    new RegExp(Digest.pattern!).test(metadata.digest)
  if (
    !validIdentity ||
    !validBytes ||
    !['image/jpeg', 'image/png', 'application/pdf'].includes(metadata.mediaType)
  ) {
    throw new Error('attachment_request_refused')
  }
}
