import { PositivePk } from '@invimport/contracts'
import { strictJson } from '@invimport/contracts/json'
import { BoundedBodyError, readBoundedBody } from '#/capture/bounded-body.ts'
import { storableText } from '#/db/storable-text.ts'
import {
  CATEGORY_PARAMETERS_MAX,
  InventoryTransportError,
  LIST_MAX_TIMEOUT_MS,
  matchListPath,
  type MatchListKind,
  type MatchListOperation,
  type ReadOperation,
} from './transport.ts'

/** Part fields Match uses; `category` and `variant_of` are absent from InvenTree's brief Part. */
export interface MatchPart {
  pk: string
  name: string
  IPN: string | null
  category?: string | null
  has_image: boolean
  active: boolean
  variant_of?: string | null
}

export interface MatchManufacturerPart {
  pk: string
  part: string
  MPN: string | null
  manufacturer: string
  manufacturer_name: string
  part_detail: MatchPart
}

export interface MatchSupplierPart {
  pk: string
  part: string
  SKU: string
  supplier: string
  supplier_name: string
  part_detail: MatchPart
}

export interface MatchStock {
  pk: string
  part: string
  batch: string | null
  /** The target's number as a plain decimal string, such as `500` or `0.5`. */
  quantity: string
  part_detail?: MatchPart
}

export interface MatchParameter {
  pk: string
  template: string
  data: string
  model_id: string
}

export interface MatchAttachment {
  pk: string
  attachment: string | null
  link: string | null
  comment: string | null
  model_id: string
}

export interface MatchCategoryParameter {
  pk: string
  category: string
  template: string
  default_value?: string | null
}

export interface MatchCategory {
  pk: string
  name: string
  parent: string | null
}

export interface MatchRowsByKind {
  search_parts: MatchPart
  list_manufacturer_parts: MatchManufacturerPart
  list_supplier_parts: MatchSupplierPart
  list_stock: MatchStock
  list_part_parameters: MatchParameter
  list_part_attachments: MatchAttachment
  list_category_parameters: MatchCategoryParameter
}

export type MatchUnavailableReason =
  'status' | 'redirect' | 'transport' | 'malformed' | 'over_bound'
export type MatchUnavailable = { kind: 'unavailable'; reason: MatchUnavailableReason }
export type MatchListResult<Row> = { kind: 'found'; count: number; rows: Row[] } | MatchUnavailable
export type MatchRecordResult<Value> =
  { kind: 'found'; value: Value } | { kind: 'not_found' } | MatchUnavailable

export interface MatchTarget {
  /** `timeoutMs` bounds the whole request, including waiting for response headers. */
  matchList: (operation: MatchListOperation, timeoutMs: number) => Promise<Response>
  read: (operation: ReadOperation) => Promise<Response>
  targetContextId: string
}

export interface MatchReader {
  /** The target context these reads were bound to, for callers that stamp their results. */
  readonly targetContextId: string
  list<K extends MatchListKind>(
    operation: Extract<MatchListOperation, { kind: K }>,
    timeoutMs?: number,
  ): Promise<MatchListResult<MatchRowsByKind[K]>>
  category(pk: string): Promise<MatchRecordResult<MatchCategory>>
  part(pk: string): Promise<MatchRecordResult<MatchPart>>
  stock(pk: string): Promise<MatchRecordResult<MatchStock>>
}

const PAGE_BODY_MAX_BYTES = 512 * 1024
const DETAIL_BODY_MAX_BYTES = 64 * 1024
const TEXT_MAX_CHARACTERS = 2048
const MAX_PK = 9223372036854775807n
const JSON_CONTENT_TYPE = /^application\/json\s*(;.*)?$/i

/** A target answer Match can't use, tagged with why. */
class Unavailable extends Error {
  constructor(readonly reason: MatchUnavailableReason) {
    super(`match_read_${reason}`)
  }
}

function malformed(): never {
  throw new Unavailable('malformed')
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    malformed()
  }
  return value as Record<string, unknown>
}

function pk(value: unknown): string {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    malformed()
  }
  return String(value)
}

function nullablePk(value: unknown): string | null {
  return value === null ? null : pk(value)
}

/** Keeps an absent field absent, since InvenTree's brief Part omits it. */
function optionalPk(row: Record<string, unknown>, name: string) {
  return Object.hasOwn(row, name) ? { [name]: nullablePk(row[name]) } : {}
}

function text(value: unknown): string {
  // Text PostgreSQL can't store unchanged, such as NUL or an unpaired surrogate, is refused.
  if (
    typeof value !== 'string' ||
    [...value].length > TEXT_MAX_CHARACTERS ||
    !storableText(value)
  ) {
    malformed()
  }
  return value
}

function requiredText(value: unknown): string {
  const checked = text(value)
  if (checked.length === 0) {
    malformed()
  }
  return checked
}

function nullableText(value: unknown): string | null {
  return value === null ? null : text(value)
}

/** InvenTree stores a missing IPN or batch as either "" or null; both mean none. */
function blankAsNull(value: unknown): string | null {
  const checked = nullableText(value)
  return checked === '' ? null : checked
}

/**
 * Renders a JSON number as a plain decimal string. The shortest round-trip form is the most exact
 * text a double can give; an exponent is expanded so `1e-7` reads `0.0000001`.
 */
export function decimalText(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error('decimal_not_finite')
  }
  const shortest = Object.is(value, -0) ? '0' : String(value)
  const exponent = /^(-?)([0-9])(?:\.([0-9]+))?e([+-][0-9]+)$/.exec(shortest)
  if (!exponent) {
    return shortest
  }
  const [, sign, lead, rest = '', power] = exponent
  const digits = lead + rest
  const point = 1 + Number(power)
  if (point <= 0) {
    return `${sign}0.${'0'.repeat(-point)}${digits}`
  }
  if (point >= digits.length) {
    return `${sign}${digits}${'0'.repeat(point - digits.length)}`
  }
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`
}

function quantity(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    malformed()
  }
  return decimalText(value)
}

function projectPart(value: unknown): MatchPart {
  const row = object(value)
  const image = nullableText(row.image)
  const active = row.active ?? true
  if (typeof active !== 'boolean') {
    malformed()
  }
  return {
    pk: pk(row.pk),
    name: requiredText(row.name),
    IPN: blankAsNull(row.IPN),
    ...optionalPk(row, 'category'),
    has_image: image !== null && image !== '',
    active,
    ...optionalPk(row, 'variant_of'),
  }
}

/** A nested Part must be the row's own Part, or the row is not what it claims. */
function ownPartDetail(value: unknown, part: string): MatchPart {
  const detail = projectPart(value)
  if (detail.pk !== part) {
    malformed()
  }
  return detail
}

function projectManufacturerPart(value: unknown): MatchManufacturerPart {
  const row = object(value)
  const part = pk(row.part)
  return {
    pk: pk(row.pk),
    part,
    MPN: nullableText(row.MPN),
    manufacturer: pk(row.manufacturer),
    manufacturer_name: requiredText(object(row.manufacturer_detail).name),
    part_detail: ownPartDetail(row.part_detail, part),
  }
}

function projectSupplierPart(value: unknown): MatchSupplierPart {
  const row = object(value)
  const part = pk(row.part)
  return {
    pk: pk(row.pk),
    part,
    SKU: requiredText(row.SKU),
    supplier: pk(row.supplier),
    supplier_name: requiredText(object(row.supplier_detail).name),
    part_detail: ownPartDetail(row.part_detail, part),
  }
}

function projectStock(value: unknown): MatchStock {
  const row = object(value)
  const part = pk(row.part)
  const detail =
    row.part_detail === undefined || row.part_detail === null
      ? {}
      : { part_detail: ownPartDetail(row.part_detail, part) }
  return {
    pk: pk(row.pk),
    part,
    batch: blankAsNull(row.batch),
    quantity: quantity(row.quantity),
    ...detail,
  }
}

function projectParameter(value: unknown): MatchParameter {
  const row = object(value)
  return {
    pk: pk(row.pk),
    template: pk(row.template),
    data: text(row.data),
    model_id: pk(row.model_id),
  }
}

function projectAttachment(value: unknown): MatchAttachment {
  const row = object(value)
  return {
    pk: pk(row.pk),
    attachment: nullableText(row.attachment),
    link: nullableText(row.link),
    comment: nullableText(row.comment),
    model_id: pk(row.model_id),
  }
}

function projectCategoryParameter(value: unknown): MatchCategoryParameter {
  const row = object(value)
  const defaultValue = Object.hasOwn(row, 'default_value')
    ? { default_value: nullableText(row.default_value) }
    : {}
  return {
    pk: pk(row.pk),
    category: pk(row.category),
    template: pk(row.template),
    ...defaultValue,
  }
}

function projectCategory(value: unknown): MatchCategory {
  const row = object(value)
  return { pk: pk(row.pk), name: requiredText(row.name), parent: nullablePk(row.parent) }
}

const ROW_PROJECTIONS: { [K in MatchListKind]: (value: unknown) => MatchRowsByKind[K] } = {
  search_parts: projectPart,
  list_manufacturer_parts: projectManufacturerPart,
  list_supplier_parts: projectSupplierPart,
  list_stock: projectStock,
  list_part_parameters: projectParameter,
  list_part_attachments: projectAttachment,
  list_category_parameters: projectCategoryParameter,
}

/**
 * Rows a filter should have excluded make the whole read malformed: another model's row with the
 * same id, or a variant's stock, must never pass as the requested Part's.
 */
function rowMatchesOperation(operation: MatchListOperation, row: unknown) {
  if (operation.kind === 'list_part_parameters' || operation.kind === 'list_part_attachments') {
    return (row as MatchParameter | MatchAttachment).model_id === operation.part
  }
  if (operation.kind === 'list_stock' && operation.part !== undefined) {
    return (row as MatchStock).part === operation.part
  }
  return true
}

async function cancelBody(response: Response) {
  try {
    await response.body?.cancel()
  } catch {
    // The body is being discarded; a failed cancel changes nothing about the outcome.
  }
}

/** Admits only an exact HTTP 200 JSON answer and returns its parsed body. */
async function jsonBody(response: Response, maxBytes: number, deadlineMs: number) {
  if (response.status >= 300 && response.status < 400) {
    await cancelBody(response)
    throw new Unavailable('redirect')
  }
  if (response.status !== 200 || !response.body) {
    await cancelBody(response)
    throw new Unavailable('status')
  }
  if (!JSON_CONTENT_TYPE.test(response.headers.get('content-type') ?? '')) {
    await cancelBody(response)
    malformed()
  }
  let bytes: Buffer
  try {
    bytes = await readBoundedBody(response.body, maxBytes, deadlineMs)
  } catch (error) {
    if (error instanceof BoundedBodyError && error.reason === 'too_large') {
      throw new Unavailable('over_bound')
    }
    throw new Unavailable('transport')
  }
  try {
    return strictJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes), maxBytes)
  } catch {
    malformed()
  }
}

function decodeRows<K extends MatchListKind>(
  operation: Extract<MatchListOperation, { kind: K }>,
  value: unknown,
): { count: number; rows: MatchRowsByKind[K][] } {
  const envelope = object(value)
  const { count, results } = envelope
  // Upstream next/previous links are ignored; only their shape is checked.
  const linksValid = [envelope.next, envelope.previous].every(
    (link) => link === undefined || link === null || typeof link === 'string',
  )
  const paged = 'limit' in operation
  const limit = paged ? operation.limit : CATEGORY_PARAMETERS_MAX
  const offset = paged ? operation.offset : 0
  if (
    typeof count !== 'number' ||
    !Number.isSafeInteger(count) ||
    count < 0 ||
    !Array.isArray(results) ||
    results.length > limit ||
    count < offset + results.length ||
    !linksValid
  ) {
    malformed()
  }
  const project = ROW_PROJECTIONS[operation.kind] as (value: unknown) => MatchRowsByKind[K]
  const rows = results.map(project)
  if (!rows.every((row) => rowMatchesOperation(operation, row))) {
    malformed()
  }
  return { count, rows }
}

function unavailable(error: unknown): MatchUnavailable {
  if (error instanceof Unavailable) {
    return { kind: 'unavailable', reason: error.reason }
  }
  if (error instanceof InventoryTransportError) {
    return { kind: 'unavailable', reason: 'redirect' }
  }
  return { kind: 'unavailable', reason: 'transport' }
}

function requirePk(value: string) {
  const valid =
    typeof value === 'string' &&
    new RegExp(PositivePk.pattern!).test(value) &&
    BigInt(value) <= MAX_PK
  if (!valid) {
    throw new Error('read_operation_refused')
  }
}

/**
 * Typed Match reads over the read-only target. Target failures are results, never errors; only an
 * invalid operation, a caller's mistake, throws before anything is sent.
 */
export function matchReader(target: MatchTarget): MatchReader {
  async function list<K extends MatchListKind>(
    operation: Extract<MatchListOperation, { kind: K }>,
    timeoutMs = LIST_MAX_TIMEOUT_MS,
  ): Promise<MatchListResult<MatchRowsByKind[K]>> {
    matchListPath(operation, timeoutMs)
    try {
      const response = await target.matchList(operation, timeoutMs)
      const body = await jsonBody(response, PAGE_BODY_MAX_BYTES, timeoutMs)
      const { count, rows } = decodeRows(operation, body)
      // Mappings come in one response; more than it holds (rows ≤ the bound) is never paged.
      const mappingsIncomplete =
        operation.kind === 'list_category_parameters' && count > rows.length
      if (mappingsIncomplete) {
        return { kind: 'unavailable', reason: 'over_bound' }
      }
      return { kind: 'found', count, rows }
    } catch (error) {
      return unavailable(error)
    }
  }

  async function record<Value>(
    kind: 'get_category' | 'get_part' | 'get_stock',
    pkText: string,
    project: (value: unknown) => Value & { pk: string },
  ): Promise<MatchRecordResult<Value>> {
    requirePk(pkText)
    try {
      const response = await target.read({ kind, pk: pkText })
      if (response.status === 404) {
        await cancelBody(response)
        return { kind: 'not_found' }
      }
      const body = await jsonBody(response, DETAIL_BODY_MAX_BYTES, LIST_MAX_TIMEOUT_MS)
      const value = project(body)
      // Another record's answer is malformed, never this record's absence.
      if (value.pk !== pkText) {
        malformed()
      }
      return { kind: 'found', value }
    } catch (error) {
      return unavailable(error)
    }
  }

  return {
    targetContextId: target.targetContextId,
    list,
    category: (pkText) => record('get_category', pkText, projectCategory),
    part: (pkText) => record('get_part', pkText, projectPart),
    stock: (pkText) => record('get_stock', pkText, projectStock),
  }
}
