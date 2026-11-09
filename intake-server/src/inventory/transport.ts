import { createHash } from 'node:crypto'
import { MEDIA_SOURCE_MAX_BYTES } from '@invimport/contracts/media'
import { Digest, Id, PositivePk } from '@invimport/contracts'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { Readable } from 'node:stream'

export class InventoryTransportError extends Error {
  readonly code = 'target_redirect_refused'

  constructor() {
    super('target_redirect_refused')
  }
}

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
  effectsCapability?: 'owned-fake-effects/1' | 'owned-fake-effects/2'
}
export type ReadOperation = {
  kind:
    | 'get_part'
    | 'get_tagged_part'
    | 'get_location'
    | 'get_stock'
    | 'get_category'
    | 'get_parameter_template'
    | 'get_category_parameter'
    | 'get_company'
  pk: string
}
/**
 * Bounded catalogue list reads. InvenTree's LimitOffsetPagination has no default page size, so an
 * omitted limit would return the entire catalogue; every list request therefore carries one.
 */
export type ListOperation = {
  kind: 'list_locations' | 'list_supplier_companies'
  limit: number
  offset: number
  search?: string
}
export const LIST_MAX_PAGE_SIZE = 100
export const LIST_MAX_OFFSET = 10000
export const LIST_SEARCH_MAX_CHARACTERS = 100
export const LIST_MAX_TIMEOUT_MS = 5000
const LIST_PATHS = {
  list_locations: { path: '/api/stock/location/', filters: [] },
  list_supplier_companies: { path: '/api/company/', filters: [['is_supplier', 'true']] },
} as const

function listPath(operation: ListOperation) {
  const validPage =
    Number.isSafeInteger(operation.limit) &&
    operation.limit >= 1 &&
    operation.limit <= LIST_MAX_PAGE_SIZE &&
    Number.isSafeInteger(operation.offset) &&
    operation.offset >= 0 &&
    operation.offset <= LIST_MAX_OFFSET
  const search = operation.search
  const validSearch =
    search === undefined ||
    (typeof search === 'string' &&
      search.length >= 1 &&
      [...search].length <= LIST_SEARCH_MAX_CHARACTERS &&
      !/[\x00-\x1f\x7f]/.test(search))
  if (!operation || !Object.hasOwn(LIST_PATHS, operation.kind) || !validPage || !validSearch) {
    throw new Error('list_operation_refused')
  }
  const target = LIST_PATHS[operation.kind]
  const query = new URLSearchParams()
  for (const [name, value] of target.filters) {
    query.set(name, value)
  }
  query.set('limit', String(operation.limit))
  query.set('offset', String(operation.offset))
  query.set('ordering', 'name')
  if (search !== undefined) {
    query.set('search', search)
  }
  return `${target.path}?${query.toString()}`
}

const READ_PATHS = {
  get_part: 'part',
  get_tagged_part: 'part',
  get_location: 'stock/location',
  get_stock: 'stock',
  get_category: 'part/category',
  get_parameter_template: 'parameter/template',
  get_category_parameter: 'part/category/parameters',
  get_company: 'company',
} as const

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
          const contentType = message.headers['content-type']
          if ([204, 205, 304].includes(status)) {
            message.resume()
          }
          resolve(
            new Response(
              [204, 205, 304].includes(status)
                ? null
                : (Readable.toWeb(message) as ReadableStream<Uint8Array>),
              {
                status,
                headers:
                  typeof contentType === 'string' ? { 'content-type': contentType } : undefined,
              },
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
    timeoutMs = 5000,
  ): Promise<Response> {
    const response = await send(new URL(path, destination), {
      method,
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        authorization: `Token ${profile.credential}`,
        'content-type': 'application/json',
        ...headers,
      },
    })
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel()
      throw new InventoryTransportError()
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
    async probe(binding: TargetBinding) {
      assertBinding(binding)
      return request('/api/part/?limit=1', 'GET', undefined, {}, 3000)
    },
    /** The API root names the server's version; it is read beside, never instead of, the probe. */
    async serverVersion(binding: TargetBinding) {
      assertBinding(binding)
      return request('/api/', 'GET', undefined, {}, 3000)
    },
    async read(binding: TargetBinding, operation: ReadOperation) {
      assertBinding(binding)
      if (
        !operation ||
        !Object.hasOwn(READ_PATHS, operation.kind) ||
        typeof operation.pk !== 'string' ||
        !new RegExp(PositivePk.pattern!).test(operation.pk) ||
        BigInt(operation.pk) > 9223372036854775807n
      ) {
        throw new Error('read_operation_refused')
      }
      return request(
        inventoryPath(
          READ_PATHS[operation.kind],
          operation.pk,
          operation.kind === 'get_tagged_part',
        ),
        'GET',
      )
    },
    /** `timeoutMs` lets a caller's overall budget shorten, never extend, the request deadline. */
    async list(binding: TargetBinding, operation: ListOperation, timeoutMs = LIST_MAX_TIMEOUT_MS) {
      assertBinding(binding)
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > LIST_MAX_TIMEOUT_MS) {
        throw new Error('list_operation_refused')
      }
      return request(listPath(operation), 'GET', undefined, {}, timeoutMs)
    },
    async sendStock(binding: TargetBinding, retainedRequestBytes: string) {
      assertBinding(binding)
      requireOwnedMutationTarget()
      return request('/api/stock/', 'POST', retainedRequestBytes)
    },

    async readPartAttachmentMetadata(binding: TargetBinding, pk: string) {
      assertBinding(binding)
      if (!new RegExp(PositivePk.pattern!).test(pk) || BigInt(pk) > 9223372036854775807n) {
        throw new Error('part_attachment_read_refused')
      }
      return request(`/api/attachment/${pk}/`, 'GET')
    },
    async readPartAttachmentFile(
      binding: TargetBinding,
      input: { pk: string; partPk: string; path: string },
    ) {
      assertBinding(binding)
      for (const pk of [input.pk, input.partPk]) {
        if (!new RegExp(PositivePk.pattern!).test(pk) || BigInt(pk) > 9223372036854775807n) {
          throw new Error('part_attachment_read_refused')
        }
      }
      const path = qualifiedAttachmentPath(input.path, destination)
      return request(path, 'GET')
    },
    async sendPartAttachment(binding: TargetBinding, body: Buffer, contentType: string) {
      assertBinding(binding)
      requireOwnedMutationTarget()
      if (
        !effectsAllowed(profile.effectsCapability, 'part_attachment') ||
        body.length > MEDIA_SOURCE_MAX_BYTES + 8192 ||
        !/^multipart\/form-data; boundary=bench-[a-f0-9-]+$/.test(contentType)
      ) {
        throw new Error('part_attachment_send_refused')
      }
      return request('/api/attachment/', 'POST', new Uint8Array(body), {
        'content-type': contentType,
      })
    },
    async sendCompanyWithImage(binding: TargetBinding, body: Buffer, contentType: string) {
      assertBinding(binding)
      requireOwnedMutationTarget()
      if (
        !effectsAllowed(profile.effectsCapability, 'create_company') ||
        body.length > MEDIA_SOURCE_MAX_BYTES + 8192 ||
        !/^multipart\/form-data; boundary=bench-[a-f0-9-]+$/.test(contentType)
      ) {
        throw new Error('company_image_send_refused')
      }
      return request('/api/company/', 'POST', new Uint8Array(body), {
        'content-type': contentType,
      })
    },
    async sendSupported(
      binding: TargetBinding,
      kind: SupportedMutationKind,
      retainedRequestBytes: string,
    ) {
      assertBinding(binding)
      requireOwnedMutationTarget()
      if (
        !effectsAllowed(profile.effectsCapability, kind) ||
        kind === 'part_attachment' ||
        !Object.hasOwn(SUPPORTED_PATHS, kind)
      ) {
        throw new Error('effects_capability_refused')
      }
      return request(
        inventoryPath(SUPPORTED_PATHS[kind], undefined, kind === 'create_part'),
        'POST',
        retainedRequestBytes,
      )
    },
    async readSupported(binding: TargetBinding, kind: SupportedMutationKind, pk: string) {
      assertBinding(binding)
      requireOwnedMutationTarget()
      if (
        !effectsAllowed(profile.effectsCapability, kind) ||
        kind === 'part_attachment' ||
        !Object.hasOwn(SUPPORTED_PATHS, kind) ||
        !new RegExp(PositivePk.pattern!).test(pk) ||
        BigInt(pk) > 9223372036854775807n
      ) {
        throw new Error('effects_read_refused')
      }
      return request(inventoryPath(SUPPORTED_PATHS[kind], pk, kind === 'create_part'), 'GET')
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
    bytes.length <= MEDIA_SOURCE_MAX_BYTES &&
    metadata.byteSize === String(bytes.length) &&
    new RegExp(Digest.pattern!).test(metadata.digest) &&
    createHash('sha256').update(bytes).digest('hex') === metadata.digest
  if (
    !validIdentity ||
    !validBytes ||
    !['image/jpeg', 'image/png', 'application/pdf'].includes(metadata.mediaType)
  ) {
    throw new Error('attachment_request_refused')
  }
}

function inventoryPath(family: string, pk?: string, tags = false) {
  const path = pk ? `/api/${family}/${pk}/` : `/api/${family}/`
  return tags ? `${path}?tags=true` : path
}

export type SupportedMutationKind =
  | 'create_part'
  | 'parameter'
  | 'manufacturer'
  | 'supplier'
  | 'create_stock'
  | 'part_attachment'
  | 'create_location'
  | 'create_company'
const RECORD_KINDS: readonly SupportedMutationKind[] = ['create_location', 'create_company']

/** Record creation needs the `/2` capability; every other effect runs under either version. */
function effectsAllowed(
  capability: TargetProfile['effectsCapability'],
  kind: SupportedMutationKind,
) {
  return RECORD_KINDS.includes(kind)
    ? capability === 'owned-fake-effects/2'
    : capability === 'owned-fake-effects/1' || capability === 'owned-fake-effects/2'
}

const SUPPORTED_PATHS = {
  create_location: 'stock/location',
  create_company: 'company',
  create_part: 'part',
  parameter: 'parameter',
  manufacturer: 'company/part/manufacturer',
  supplier: 'company/part',
  part_attachment: 'attachment',
  create_stock: 'stock',
} as const

/** Only metadata-bound same-origin local media is supported; signed/custom storage URLs fail closed. */
export function qualifiedAttachmentPath(value: string, destination: URL) {
  if (typeof value !== 'string' || value.length > 2048 || /[\\\x00-\x20\x7f]/.test(value)) {
    throw new Error('part_attachment_path_refused')
  }
  let decoded: string
  try {
    decoded = decodeURIComponent(value)
  } catch {
    throw new Error('part_attachment_path_refused')
  }
  if (
    decoded.includes('\\') ||
    decoded.split('/').some((segment) => segment === '.' || segment === '..')
  ) {
    throw new Error('part_attachment_path_refused')
  }
  const url = new URL(value, destination)
  if (
    url.origin !== destination.origin ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.startsWith('/media/attachments/')
  ) {
    throw new Error('part_attachment_path_refused')
  }
  return url.pathname
}
