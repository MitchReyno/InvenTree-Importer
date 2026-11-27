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
export const CONNECTION_PROBE_TIMEOUT_MS = 10_000
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

interface MatchPage {
  limit: number
  offset: number
}

/**
 * Match's bounded list reads. Each kind has a fixed path, fixed parameters and only the filters
 * named here, checked against the pinned InvenTree 1.5.0 / API 530 schema.
 */
export type MatchListOperation =
  | ({ kind: 'search_parts'; search: string } & MatchPage)
  | ({
      kind: 'list_manufacturer_parts'
      mpn?: string
      manufacturer?: string
      part?: string
    } & MatchPage)
  | ({ kind: 'list_supplier_parts'; sku?: string; supplier?: string; part?: string } & MatchPage)
  | ({ kind: 'list_stock'; part?: string; batch?: string; nsn_tag?: string } & MatchPage)
  | ({ kind: 'list_part_parameters'; part: string } & MatchPage)
  | ({ kind: 'list_part_attachments'; part: string } & MatchPage)
  | { kind: 'list_category_parameters'; category: string }
export type MatchListKind = MatchListOperation['kind']
/**
 * The pinned API offers no ordering for category mappings, so they are read in one response of
 * at most this many rows and sorted by the caller; a larger set is never merged from pages.
 */
export const CATEGORY_PARAMETERS_MAX = 100
/** The importer's canonical NSN stock tag. */
export const NSN_TAG_PATTERN = /^nsn:[0-9]{4}-[0-9]{2}-[0-9]{3}-[0-9]{4}$/
const MAX_PK = 9223372036854775807n

type MatchValue = 'pk' | 'text' | 'nsn_tag'
type MatchQueryEntry =
  | { fixed: string; value: string }
  | { param: string; property: string; value: MatchValue; required: boolean }

interface MatchListShape {
  path: string
  /** Paged kinds take the caller's limit and offset; the others send one fixed bound. */
  paged: boolean
  /** At least one optional filter must be present, so no kind can list a whole table. */
  needsFilter: boolean
  query: readonly MatchQueryEntry[]
}

function fixed(name: string, value: string): MatchQueryEntry {
  return { fixed: name, value }
}

function filter(
  property: string,
  param: string,
  value: MatchValue,
  required = false,
): MatchQueryEntry {
  return { param, property, value, required }
}

const MATCH_LISTS: Record<MatchListKind, MatchListShape> = {
  search_parts: {
    path: '/api/part/',
    paged: true,
    needsFilter: false,
    query: [fixed('ordering', 'name'), filter('search', 'search', 'text', true)],
  },
  list_manufacturer_parts: {
    path: '/api/company/part/manufacturer/',
    paged: true,
    needsFilter: true,
    query: [
      fixed('manufacturer_detail', 'true'),
      fixed('part_detail', 'true'),
      fixed('ordering', 'MPN'),
      filter('mpn', 'MPN', 'text'),
      filter('manufacturer', 'manufacturer', 'pk'),
      filter('part', 'part', 'pk'),
    ],
  },
  list_supplier_parts: {
    path: '/api/company/part/',
    paged: true,
    needsFilter: true,
    query: [
      fixed('supplier_detail', 'true'),
      fixed('part_detail', 'true'),
      fixed('ordering', 'SKU'),
      filter('sku', 'SKU', 'text'),
      filter('supplier', 'supplier', 'pk'),
      filter('part', 'part', 'pk'),
    ],
  },
  list_stock: {
    path: '/api/stock/',
    paged: true,
    needsFilter: true,
    // Without include_variants=false a Part filter also returns its variants' stock.
    query: [
      fixed('include_variants', 'false'),
      fixed('part_detail', 'true'),
      fixed('ordering', 'part'),
      filter('part', 'part', 'pk'),
      filter('batch', 'batch', 'text'),
      filter('nsn_tag', 'tags__name', 'nsn_tag'),
    ],
  },
  list_part_parameters: {
    path: '/api/parameter/',
    paged: true,
    needsFilter: false,
    query: [
      fixed('model_type', 'part'),
      filter('part', 'model_id', 'pk', true),
      fixed('ordering', 'template'),
    ],
  },
  list_part_attachments: {
    path: '/api/attachment/',
    paged: true,
    needsFilter: false,
    query: [
      fixed('model_type', 'part'),
      filter('part', 'model_id', 'pk', true),
      fixed('ordering', 'upload_date'),
    ],
  },
  list_category_parameters: {
    path: '/api/part/category/parameters/',
    paged: false,
    needsFilter: false,
    query: [filter('category', 'category', 'pk', true)],
  },
}

function isPk(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    new RegExp(PositivePk.pattern!).test(value) &&
    BigInt(value) <= MAX_PK
  )
}

function isSearchText(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    [...value].length <= LIST_SEARCH_MAX_CHARACTERS &&
    !/[\x00-\x1f\x7f]/.test(value)
  )
}

function validPage(operation: Record<string, unknown>) {
  const { limit, offset } = operation
  return (
    typeof limit === 'number' &&
    Number.isSafeInteger(limit) &&
    limit >= 1 &&
    limit <= LIST_MAX_PAGE_SIZE &&
    typeof offset === 'number' &&
    Number.isSafeInteger(offset) &&
    offset >= 0 &&
    offset <= LIST_MAX_OFFSET
  )
}

function validMatchValue(kind: MatchValue, value: unknown) {
  if (kind === 'pk') {
    return isPk(value)
  }
  if (kind === 'nsn_tag') {
    return typeof value === 'string' && NSN_TAG_PATTERN.test(value)
  }
  return isSearchText(value)
}

function refuseMatchList(): never {
  throw new Error('list_operation_refused')
}

/**
 * Validates a Match list read and builds its path, refusing before any request is sent. Exported
 * so a reader can tell its own invalid operation from a target failure.
 */
export function matchListPath(operation: MatchListOperation, timeoutMs = LIST_MAX_TIMEOUT_MS) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > LIST_MAX_TIMEOUT_MS) {
    refuseMatchList()
  }
  if (!operation || typeof operation !== 'object' || Array.isArray(operation)) {
    refuseMatchList()
  }
  const fields = operation as unknown as Record<string, unknown>
  if (typeof fields.kind !== 'string' || !Object.hasOwn(MATCH_LISTS, fields.kind)) {
    refuseMatchList()
  }
  const shape = MATCH_LISTS[fields.kind as MatchListKind]
  const allowed = new Set(['kind'])
  if (shape.paged) {
    allowed.add('limit')
    allowed.add('offset')
  }
  for (const entry of shape.query) {
    if ('property' in entry) {
      allowed.add(entry.property)
    }
  }
  const unknownProperty = Object.keys(fields).some((name) => !allowed.has(name))
  if (unknownProperty || (shape.paged && !validPage(fields))) {
    refuseMatchList()
  }

  const query = new URLSearchParams()
  let filters = 0
  for (const entry of shape.query) {
    if ('fixed' in entry) {
      query.set(entry.fixed, entry.value)
      continue
    }
    const value = fields[entry.property]
    if (value === undefined && !entry.required) {
      continue
    }
    if (!validMatchValue(entry.value, value)) {
      refuseMatchList()
    }
    query.set(entry.param, value as string)
    filters += 1
  }
  if (shape.needsFilter && filters === 0) {
    refuseMatchList()
  }
  query.set('limit', String(shape.paged ? fields.limit : CATEGORY_PARAMETERS_MAX))
  query.set('offset', String(shape.paged ? fields.offset : 0))
  return `${shape.path}?${query.toString()}`
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

export interface TransportOptions {
  /** Supplies the token per request when it can change at runtime; defaults to the profile's. */
  credential?: () => string
  /** Ends any response that echoes the request's token, for reads whose results reach a browser. */
  refuseEcho?: boolean
}

export class TokenEchoError extends Error {
  readonly code = 'target_echoed_token'

  constructor() {
    super('target_echoed_token')
  }
}

/**
 * Ends a response body with an error if it contains the token the request sent, raw or as a
 * JSON string, so nothing read from the target can carry the token on to a caller.
 */
export function withoutEcho(response: Response, token: string): Response {
  if (!response.body || token === '') {
    return response
  }
  const forms = [...new Set([token, JSON.stringify(token).slice(1, -1)])].map((form) =>
    Buffer.from(form, 'utf8'),
  )
  const overlap = Math.max(...forms.map((form) => form.length)) - 1
  let tail = Buffer.alloc(0)
  const scan = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      // The previous chunk's end is kept, so a token split across chunks is still found.
      const joined = Buffer.concat([tail, chunk])
      if (forms.some((form) => joined.includes(form))) {
        controller.error(new TokenEchoError())
        return
      }
      controller.enqueue(chunk)
      tail = joined.subarray(Math.max(0, joined.length - overlap))
    },
  })
  return new Response(response.body.pipeThrough(scan), {
    status: response.status,
    headers: response.headers,
  })
}

/**
 * Transport defense in depth, NOT approval or request-journal authority. Only T03 apply may receive this closure.
 * Options apply only to the app's reads; the approval runner's transport keeps the defaults.
 */
export function inventoryTransport(
  input: TargetProfile,
  send: typeof fetch = singleSend,
  options: TransportOptions = {},
) {
  const profile = structuredClone(input)
  const currentCredential = options.credential ?? (() => profile.credential)
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
    signal?: AbortSignal,
  ): Promise<Response> {
    const token = currentCredential()
    const response = await send(new URL(path, destination), {
      method,
      body,
      redirect: 'manual',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
        : AbortSignal.timeout(timeoutMs),
      headers: {
        authorization: `Token ${token}`,
        'content-type': 'application/json',
        ...headers,
      },
    })
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel()
      throw new InventoryTransportError()
    }
    return options.refuseEcho ? withoutEcho(response, token) : response
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
    async verifyCandidate(binding: TargetBinding) {
      assertBinding(binding)
      return request('/api/part/?limit=1', 'GET')
    },
    async probe(binding: TargetBinding, signal?: AbortSignal) {
      assertBinding(binding)
      return request(
        '/api/part/?limit=1',
        'GET',
        undefined,
        {},
        CONNECTION_PROBE_TIMEOUT_MS,
        signal,
      )
    },
    /** The API root names the server's version; it is read beside, never instead of, the probe. */
    async serverVersion(binding: TargetBinding, signal?: AbortSignal) {
      assertBinding(binding)
      return request('/api/', 'GET', undefined, {}, CONNECTION_PROBE_TIMEOUT_MS, signal)
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
    /** Match list reads, under the same bounds and timeout rule as `list`. */
    async matchList(
      binding: TargetBinding,
      operation: MatchListOperation,
      timeoutMs = LIST_MAX_TIMEOUT_MS,
    ) {
      assertBinding(binding)
      return request(matchListPath(operation, timeoutMs), 'GET', undefined, {}, timeoutMs)
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
