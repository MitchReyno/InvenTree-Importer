import {
  CATALOGUE_CANDIDATE_LIMIT,
  CATALOGUE_QUERY_MAX_CHARACTERS,
  CATALOGUE_SEARCH_PAGE_SIZE,
  validate,
  type CatalogueCandidatesDto,
  type CatalogueModelDto,
  type CatalogueRecordDto,
  type CatalogueSearchDto,
} from '@invimport/contracts'
import { strictJson } from '@invimport/contracts/json'
import type { ListOperation, ReadOperation } from '#/inventory/transport.ts'
import { readBoundedBody } from './bounded-body.ts'
import { fail } from './model.ts'

export type { ListOperation }

export interface CatalogueReader {
  search(model: CatalogueModelDto, query: string): Promise<CatalogueSearchDto>
  candidates(model: CatalogueModelDto): Promise<CatalogueCandidatesDto>
}

interface CatalogueTarget {
  /** `timeoutMs` bounds the whole request, including waiting for response headers. */
  list: (operation: ListOperation, timeoutMs: number) => Promise<Response>
  read: (operation: ReadOperation) => Promise<Response>
  targetContextId: string
  /** Injectable monotonic clock in milliseconds; defaults to performance.now. */
  now?: () => number
}

const PAGE_BODY_MAX_BYTES = 512 * 1024
const DETAIL_BODY_MAX_BYTES = 64 * 1024
const BODY_DEADLINE_MS = 5000
const SNAPSHOT_PAGE_SIZE = 100
const SNAPSHOT_DEADLINE_MS = 15000
/** Per-process bound on concurrent catalogue reads, so typing cannot fan out target traffic. */
const MAX_CONCURRENT_READS = 2
const MAX_PK = 9223372036854775807n
const NUMERIC_ID = /^[1-9][0-9]{0,18}$/
const TEXT_MAX_CHARACTERS = 2048

/** Raised for any target response that is not exactly the admitted shape. */
class InvalidCatalogueResponse extends Error {
  constructor() {
    super('catalogue_response_invalid')
  }
}

function invalid(): never {
  throw new InvalidCatalogueResponse()
}

function exactPk(value: unknown): string {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    invalid()
  }
  return String(value)
}

function boundedText(value: unknown, { required }: { required: boolean }): string {
  if (value === null && !required) {
    return ''
  }
  if (typeof value !== 'string' || [...value].length > TEXT_MAX_CHARACTERS) {
    invalid()
  }
  if (required && (value.length === 0 || [...value].length > 256)) {
    invalid()
  }
  return value
}

function decodeRecord(model: CatalogueModelDto, value: unknown): CatalogueRecordDto | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid()
  }
  const row = value as Record<string, unknown>
  const pk = exactPk(row.pk)
  const name = boundedText(row.name, { required: true })
  const description = boundedText(row.description ?? null, { required: false })
  if (model === 'location') {
    const parent = row.parent === null ? null : exactPk(row.parent)
    if (typeof row.structural !== 'boolean') {
      invalid()
    }
    return {
      kind: 'location',
      pk,
      name,
      description,
      path: boundedText(row.pathstring, { required: false }),
      parent_pk: parent,
      structural: row.structural,
    }
  }
  if (typeof row.is_supplier !== 'boolean' || typeof row.is_manufacturer !== 'boolean') {
    invalid()
  }
  if (!row.is_supplier) {
    return null
  }
  return { kind: 'supplier', pk, name, description, manufacturer: row.is_manufacturer }
}

async function responseBytes(response: Response, maxBytes: number, deadlineMs = BODY_DEADLINE_MS) {
  if (!response.ok || !response.body) {
    await response.body?.cancel()
    invalid()
  }
  if (deadlineMs <= 0) {
    await response.body.cancel()
    invalid()
  }
  return readBoundedBody(response.body, maxBytes, deadlineMs)
}

interface Page {
  count: number
  records: CatalogueRecordDto[]
}

async function decodePage(
  model: CatalogueModelDto,
  response: Response,
  operation: ListOperation,
  deadlineMs: number,
): Promise<Page> {
  const bytes = await responseBytes(response, PAGE_BODY_MAX_BYTES, deadlineMs)
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  const value: unknown = strictJson(text, PAGE_BODY_MAX_BYTES)
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid()
  }
  const envelope = value as Record<string, unknown>
  const count = envelope.count
  const results = envelope.results
  // Upstream next/previous URLs are deliberately ignored; offsets are rebuilt locally.
  const linksValid = [envelope.next, envelope.previous].every(
    (link) => link === null || typeof link === 'string',
  )
  if (
    typeof count !== 'number' ||
    !Number.isSafeInteger(count) ||
    count < 0 ||
    !Array.isArray(results) ||
    results.length > operation.limit ||
    count < operation.offset + results.length ||
    !linksValid
  ) {
    invalid()
  }
  const records: CatalogueRecordDto[] = []
  for (const row of results) {
    const record = decodeRecord(model, row)
    if (record === null) {
      // The target ignored the supplier filter; its results cannot be trusted as suppliers.
      invalid()
    }
    records.push(record)
  }
  return { count, records }
}

function listKind(model: CatalogueModelDto): ListOperation['kind'] {
  return model === 'location' ? 'list_locations' : 'list_supplier_companies'
}

function detailKind(model: CatalogueModelDto): ReadOperation['kind'] {
  return model === 'location' ? 'get_location' : 'get_company'
}

function requireQuery(query: string) {
  const valid =
    typeof query === 'string' &&
    query.length >= 1 &&
    [...query].length <= CATALOGUE_QUERY_MAX_CHARACTERS &&
    !/[\x00-\x1f\x7f]/.test(query)
  if (!valid) {
    fail('invalid_catalogue_query', 400)
  }
}

function numericId(query: string) {
  return NUMERIC_ID.test(query) && BigInt(query) <= MAX_PK ? query : null
}

export function catalogueReader(target: CatalogueTarget): CatalogueReader {
  let inFlight = 0
  const now = target.now ?? (() => performance.now())

  async function bounded<T>(work: () => Promise<T>): Promise<T> {
    if (inFlight >= MAX_CONCURRENT_READS) {
      fail('catalogue_busy', 429)
    }
    inFlight += 1
    try {
      return await work()
    } catch {
      // Invalid shapes and transport, body or decoder failures are all unavailability,
      // never an empty catalogue.
      return fail('catalogue_unavailable', 503)
    } finally {
      inFlight -= 1
    }
  }

  async function listPage(
    model: CatalogueModelDto,
    operation: ListOperation,
    deadlineMs = BODY_DEADLINE_MS,
  ) {
    return decodePage(model, await target.list(operation, deadlineMs), operation, deadlineMs)
  }

  async function exactId(model: CatalogueModelDto, pk: string) {
    const response = await target.read({ kind: detailKind(model), pk })
    if (response.status === 404) {
      await response.body?.cancel()
      return { status: 'not_found' as const }
    }
    const bytes = await responseBytes(response, DETAIL_BODY_MAX_BYTES)
    const value: unknown = strictJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    const record = decodeRecord(model, value)
    if (record === null) {
      return { status: 'not_found' as const }
    }
    if (record.pk !== pk) {
      invalid()
    }
    return { status: 'found' as const, record }
  }

  async function search(model: CatalogueModelDto, query: string): Promise<CatalogueSearchDto> {
    requireQuery(query)
    const result = await bounded(async () => {
      const operation = {
        kind: listKind(model),
        limit: CATALOGUE_SEARCH_PAGE_SIZE,
        offset: 0,
        search: query,
      }
      const page = await listPage(model, operation)
      const id = numericId(query)
      const exact = id === null ? { status: 'not_requested' as const } : await exactId(model, id)
      return {
        model,
        target_context_id: target.targetContextId,
        query,
        results: page.records,
        coverage: {
          loaded: page.records.length,
          total: page.count,
          truncated: page.count > page.records.length,
        },
        exact_id: exact,
      }
    })
    validate('CatalogueSearch', result)
    return result
  }

  /** Name-ordered snapshot independent of strict search, so typo matches can still be ranked. */
  async function candidates(model: CatalogueModelDto): Promise<CatalogueCandidatesDto> {
    const result = await bounded(async () => {
      const deadline = now() + SNAPSHOT_DEADLINE_MS
      const byPk = new Map<string, CatalogueRecordDto>()
      let total = 0
      let exhausted = false
      for (let offset = 0; offset < CATALOGUE_CANDIDATE_LIMIT; offset += SNAPSHOT_PAGE_SIZE) {
        const limit = Math.min(SNAPSHOT_PAGE_SIZE, CATALOGUE_CANDIDATE_LIMIT - offset)
        const operation = { kind: listKind(model), limit, offset }
        // Every request and body read gets only what remains of the whole snapshot budget.
        const requestBudget = Math.min(BODY_DEADLINE_MS, Math.floor(deadline - now()))
        if (requestBudget < 1) {
          invalid()
        }
        const response = await target.list(operation, requestBudget)
        const bodyBudget = Math.min(BODY_DEADLINE_MS, Math.floor(deadline - now()))
        const page = await decodePage(model, response, operation, bodyBudget)
        if (now() > deadline) {
          invalid()
        }
        total = page.count
        for (const record of page.records) {
          if (!byPk.has(record.pk)) {
            byPk.set(record.pk, record)
          }
        }
        if (page.records.length < limit || offset + limit >= page.count) {
          exhausted = byPk.size >= page.count
          break
        }
      }
      const records = [...byPk.values()].slice(0, CATALOGUE_CANDIDATE_LIMIT)
      return {
        model,
        target_context_id: target.targetContextId,
        candidates: records,
        coverage: { loaded: records.length, total, truncated: !exhausted },
      }
    })
    validate('CatalogueCandidates', result)
    return result
  }

  return { search, candidates }
}
