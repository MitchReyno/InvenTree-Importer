import { effectsFakeRequest, initializeEffectsFake } from './effects-fake.ts'
import { attachmentFakeRequest, initializeAttachmentFake } from './attachment-fake.ts'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Pool } from 'pg'
import { transaction } from '#/db/database.ts'

/** Owned persistent HTTP fake. PG, not a JS map, owns requests, faults and stock.
 * Restart the listener with the same pool to retain ALL receipts and effects.
 */
export async function inventoryFake(
  pool: Pool,
  port = 0,
  names = false,
  media = false,
  effects = false,
  initialize = true,
) {
  if (initialize) {
    await pool.query(`CREATE TABLE IF NOT EXISTS fake_request (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,method text NOT NULL,path text NOT NULL,body bytea NOT NULL);
      CREATE TABLE IF NOT EXISTS fake_stock (pk bigint GENERATED ALWAYS AS IDENTITY (START WITH 7101) PRIMARY KEY,request_id bigint NOT NULL REFERENCES fake_request(id),part text NOT NULL,location text,quantity text NOT NULL,barcode text NOT NULL);
      CREATE TABLE IF NOT EXISTS fake_control (id integer PRIMARY KEY CHECK (id=1),fault text NOT NULL);
      INSERT INTO fake_control VALUES (1,'none') ON CONFLICT DO NOTHING;`)
    await initializeMatchFake(pool)
    if (effects) {
      await initializeEffectsFake(pool)
    }
    if (media) {
      await initializeAttachmentFake(pool)
    }
  }
  const server = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const bytes = Buffer.concat(chunks)
      const { row, fault, stock } = await transaction(pool, async (client) => {
        const row = (
          await client.query(
            'INSERT INTO fake_request(method,path,body) VALUES ($1,$2,$3) RETURNING id',
            [request.method, request.url, bytes],
          )
        ).rows[0]
        const fault = (await client.query('SELECT fault FROM fake_control WHERE id=1')).rows[0]
          .fault
        let stock
        if (request.method === 'POST' && request.url === '/api/stock/' && fault !== 'redirect') {
          const value = JSON.parse(bytes.toString())
          stock = (
            await client.query(
              'INSERT INTO fake_stock(request_id,part,location,quantity,barcode) VALUES ($1,$2,$3,$4,$5) RETURNING *',
              [row.id, value.part, value.location, value.quantity, value.barcode],
            )
          ).rows[0]
        }
        return { row, fault, stock }
      })
      if (request.method === 'GET' && (await matchFakeRequest(pool, request, response, fault))) {
        return
      }
      if (effects && (await effectsFakeRequest(pool, request, response, bytes, fault, row.id))) {
        return
      }
      if (media && (await attachmentFakeRequest(pool, request, response, bytes, fault))) {
        return
      }
      void row
      response.setHeader('content-type', 'application/json')
      if (request.method === 'GET') {
        if (fault === 'read_unavailable') {
          response.writeHead(503).end('{}')
          return
        }
        if (fault === 'hold_reads') {
          while (
            (await pool.query('SELECT fault FROM fake_control WHERE id=1')).rows[0].fault ===
              'hold_reads' &&
            !response.destroyed
          ) {
            await new Promise((resolve) => setTimeout(resolve, 25))
          }
        }
        if (request.url === '/api/') {
          response.end(JSON.stringify({ server: 'InvenTree', version: '0.17.10', apiVersion: 300 }))
          return
        }
        if (request.url === '/api/part/?limit=1') {
          response.end(
            JSON.stringify({
              count: 1,
              next: null,
              previous: null,
              results: [{ pk: 29, name: 'Existing Part 29' }],
            }),
          )
          return
        }
        const stockMatch = /^\/api\/stock\/([1-9][0-9]*)\/$/.exec(request.url!)
        if (stockMatch) {
          const stored = (
            await pool.query(
              'SELECT pk,part,location,quantity,barcode FROM fake_stock WHERE pk=$1',
              [stockMatch[1]],
            )
          ).rows[0]
          response.statusCode = stored ? 200 : 404
          response.end(JSON.stringify(stored ?? {}))
          return
        }
        const url = new URL(request.url!, 'http://inventory-fake.invalid')
        const match = /^\/api\/(part|stock\/location)\/([1-9][0-9]*)\/$/.exec(url.pathname)
        if (!match) {
          response.writeHead(404).end('{}')
          return
        }
        const name = match[1] === 'part' ? `Existing Part ${match[2]}` : `Location ${match[2]}`
        // Existing fake Parts carry no tags; the optional field appears only with ?tags=true.
        const tags =
          match[1] === 'part' && url.searchParams.get('tags') === 'true' ? { tags: [] } : {}
        response.end(JSON.stringify({ pk: match[2], ...(names ? { name } : {}), ...tags }))
        return
      }
      if (fault === 'redirect') {
        response.writeHead(307, { location: '/forbidden-redirect-sink' }).end()
        return
      }
      if (fault === 'drop_response') {
        response.destroy()
        return
      }
      if (fault === 'hold_response') {
        while (
          (await pool.query('SELECT fault FROM fake_control WHERE id=1')).rows[0].fault ===
            'hold_response' &&
          !response.destroyed
        )
          await new Promise((resolve) => setTimeout(resolve, 25))
      }
      response.statusCode = 201
      response.end(
        JSON.stringify(
          fault === 'malformed'
            ? { pk: stock.pk }
            : {
                pk: stock.pk,
                part: stock.part,
                location: stock.location,
                quantity: stock.quantity,
                barcode: stock.barcode,
              },
        ),
      )
    })().catch(() => {
      if (!response.destroyed) response.writeHead(500).end('{}')
    })
  })
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('fake_listener_missing')
  return {
    origin: `http://127.0.0.1:${address.port}`,
    port: address.port,
    async close() {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
    },
    async fault(value: string) {
      await pool.query('UPDATE fake_control SET fault=$1 WHERE id=1', [value])
    },
    async records() {
      return (await pool.query('SELECT method,path,body FROM fake_request ORDER BY id')).rows as {
        method: string
        path: string
        body: Buffer
      }[]
    },
    /** Inserts Match records with explicit PKs, in one transaction. */
    async seedMatch(records: MatchFakeRecords) {
      await seedMatchFake(pool, records)
    },
    async stocks() {
      return (
        await pool.query('SELECT pk,part,location,quantity,barcode FROM fake_stock ORDER BY pk')
      ).rows
    },
  }
}

/** Seed rows for the fake's Match reads; PKs are explicit so tests can name them. */
export interface MatchFakeRecords {
  parts?: {
    pk: number
    name: string
    ipn?: string | null
    description?: string
    category?: number | null
    image?: string | null
    active?: boolean
    variant_of?: number | null
  }[]
  manufacturerParts?: {
    pk: number
    part: number
    mpn: string | null
    manufacturer: number
    manufacturer_name: string
  }[]
  supplierParts?: {
    pk: number
    part: number
    sku: string
    supplier: number
    supplier_name: string
  }[]
  stock?: { pk: number; part: number; batch?: string | null; quantity: string; tags?: string[] }[]
  parameters?: {
    pk: number
    model_type: string
    model_id: number
    template: number
    data: string
  }[]
  attachments?: {
    pk: number
    model_type: string
    model_id: number
    attachment?: string | null
    link?: string | null
    comment?: string | null
    upload_date?: string
  }[]
  categories?: { pk: number; name: string; parent?: number | null }[]
  categoryParameters?: {
    pk: number
    category: number
    template: number
    default_value?: string | null
  }[]
}

async function initializeMatchFake(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fake_match_part (
      pk bigint PRIMARY KEY,
      name text NOT NULL,
      ipn text,
      description text NOT NULL DEFAULT '',
      category bigint,
      image text,
      active boolean NOT NULL DEFAULT true,
      variant_of bigint
    );
    CREATE TABLE IF NOT EXISTS fake_match_manufacturer_part (
      pk bigint PRIMARY KEY,
      part bigint NOT NULL,
      mpn text,
      manufacturer bigint NOT NULL,
      manufacturer_name text NOT NULL
    );
    CREATE TABLE IF NOT EXISTS fake_match_supplier_part (
      pk bigint PRIMARY KEY,
      part bigint NOT NULL,
      sku text NOT NULL,
      supplier bigint NOT NULL,
      supplier_name text NOT NULL
    );
    CREATE TABLE IF NOT EXISTS fake_match_stock (
      pk bigint PRIMARY KEY,
      part bigint NOT NULL,
      batch text,
      quantity text NOT NULL,
      tags text[] NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS fake_match_parameter (
      pk bigint PRIMARY KEY,
      model_type text NOT NULL,
      model_id bigint NOT NULL,
      template bigint NOT NULL,
      data text NOT NULL
    );
    CREATE TABLE IF NOT EXISTS fake_match_attachment (
      pk bigint PRIMARY KEY,
      model_type text NOT NULL,
      model_id bigint NOT NULL,
      attachment text,
      link text,
      comment text,
      upload_date timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS fake_match_category (
      pk bigint PRIMARY KEY,
      name text NOT NULL,
      parent bigint
    );
    CREATE TABLE IF NOT EXISTS fake_match_category_parameter (
      pk bigint PRIMARY KEY,
      category bigint NOT NULL,
      template bigint NOT NULL,
      default_value text
    );`)
}

async function seedMatchFake(pool: Pool, records: MatchFakeRecords) {
  await transaction(pool, async (client) => {
    for (const part of records.parts ?? []) {
      await client.query(
        `INSERT INTO fake_match_part
           (pk, name, ipn, description, category, image, active, variant_of)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          part.pk,
          part.name,
          part.ipn ?? null,
          part.description ?? '',
          part.category ?? null,
          part.image ?? null,
          part.active ?? true,
          part.variant_of ?? null,
        ],
      )
    }
    for (const row of records.manufacturerParts ?? []) {
      await client.query(
        `INSERT INTO fake_match_manufacturer_part (pk, part, mpn, manufacturer, manufacturer_name)
         VALUES ($1, $2, $3, $4, $5)`,
        [row.pk, row.part, row.mpn, row.manufacturer, row.manufacturer_name],
      )
    }
    for (const row of records.supplierParts ?? []) {
      await client.query(
        `INSERT INTO fake_match_supplier_part (pk, part, sku, supplier, supplier_name)
         VALUES ($1, $2, $3, $4, $5)`,
        [row.pk, row.part, row.sku, row.supplier, row.supplier_name],
      )
    }
    for (const row of records.stock ?? []) {
      await client.query(
        `INSERT INTO fake_match_stock (pk, part, batch, quantity, tags)
         VALUES ($1, $2, $3, $4, $5)`,
        [row.pk, row.part, row.batch ?? null, row.quantity, row.tags ?? []],
      )
    }
    for (const row of records.parameters ?? []) {
      await client.query(
        `INSERT INTO fake_match_parameter (pk, model_type, model_id, template, data)
         VALUES ($1, $2, $3, $4, $5)`,
        [row.pk, row.model_type, row.model_id, row.template, row.data],
      )
    }
    for (const row of records.attachments ?? []) {
      await client.query(
        `INSERT INTO fake_match_attachment
           (pk, model_type, model_id, attachment, link, comment, upload_date)
         VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, now()))`,
        [
          row.pk,
          row.model_type,
          row.model_id,
          row.attachment ?? null,
          row.link ?? null,
          row.comment ?? '',
          row.upload_date ?? null,
        ],
      )
    }
    for (const row of records.categories ?? []) {
      await client.query(
        'INSERT INTO fake_match_category (pk, name, parent) VALUES ($1, $2, $3)',
        [row.pk, row.name, row.parent ?? null],
      )
    }
    for (const row of records.categoryParameters ?? []) {
      await client.query(
        `INSERT INTO fake_match_category_parameter (pk, category, template, default_value)
         VALUES ($1, $2, $3, $4)`,
        [row.pk, row.category, row.template, row.default_value ?? ''],
      )
    }
  })
}

/** PostgreSQL's undefined_table: the dev fake runs without creating Match tables. */
const UNDEFINED_TABLE = '42P01'

class FakeBadRequest extends Error {}

interface MatchPage {
  sql: string
  values: unknown[]
}

/** InvenTree answers 400 for a non-integer ID filter; the fake does the same. */
function idFilter(query: URLSearchParams, name: string): string | null {
  const value = query.get(name)
  if (value === null) {
    return null
  }
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new FakeBadRequest()
  }
  return value
}

function flag(query: URLSearchParams, name: string, fallback: boolean) {
  const value = query.get(name)
  return value === null ? fallback : ['true', '1'].includes(value.toLowerCase())
}

/** The full Part serializer's fields Match reads; IPN defaults to "" as InvenTree's does. */
function fullPart(row: Record<string, unknown>) {
  return {
    pk: Number(row.pk),
    name: row.name,
    IPN: row.ipn ?? '',
    description: row.description,
    category: row.category === null ? null : Number(row.category),
    image: row.image,
    active: row.active,
    variant_of: row.variant_of === null ? null : Number(row.variant_of),
  }
}

/** InvenTree's brief Part: nullable IPN, no category or variant_of. */
function briefPart(row: Record<string, unknown> | undefined) {
  if (!row) {
    return null
  }
  return {
    pk: Number(row.pk),
    name: row.name,
    IPN: row.ipn,
    description: row.description,
    image: row.image,
    active: row.active,
  }
}

async function partsByPk(pool: Pool, pks: unknown[]) {
  if (pks.length === 0) {
    return new Map<string, Record<string, unknown>>()
  }
  const result = await pool.query('SELECT * FROM fake_match_part WHERE pk = ANY($1::bigint[])', [
    pks,
  ])
  const rows = result.rows as Record<string, unknown>[]
  return new Map(rows.map((row) => [String(row.pk), row]))
}

function partSearch(query: URLSearchParams): MatchPage {
  const search = query.get('search')
  return {
    sql: `
      SELECT * FROM fake_match_part
      WHERE $1::text IS NULL
         OR name ILIKE '%' || $1 || '%'
         OR ipn ILIKE '%' || $1 || '%'
         OR description ILIKE '%' || $1 || '%'
      ORDER BY name, pk`,
    values: [search],
  }
}

function manufacturerParts(query: URLSearchParams): MatchPage {
  return {
    sql: `
      SELECT * FROM fake_match_manufacturer_part
      WHERE ($1::text IS NULL OR mpn = $1)
        AND ($2::bigint IS NULL OR manufacturer = $2)
        AND ($3::bigint IS NULL OR part = $3)
      ORDER BY mpn, pk`,
    values: [query.get('MPN'), idFilter(query, 'manufacturer'), idFilter(query, 'part')],
  }
}

function supplierParts(query: URLSearchParams): MatchPage {
  return {
    sql: `
      SELECT * FROM fake_match_supplier_part
      WHERE ($1::text IS NULL OR sku = $1)
        AND ($2::bigint IS NULL OR supplier = $2)
        AND ($3::bigint IS NULL OR part = $3)
      ORDER BY sku, pk`,
    values: [query.get('SKU'), idFilter(query, 'supplier'), idFilter(query, 'part')],
  }
}

/** A Part filter covers its variant tree unless include_variants=false, as InvenTree's does. */
function stockItems(query: URLSearchParams): MatchPage {
  return {
    sql: `
      WITH RECURSIVE tree AS (
        SELECT $1::bigint AS pk
        UNION
        SELECT part.pk FROM fake_match_part part JOIN tree ON part.variant_of = tree.pk
        WHERE $2::boolean
      )
      SELECT * FROM fake_match_stock
      WHERE ($1::bigint IS NULL OR part IN (SELECT pk FROM tree))
        AND ($3::text IS NULL OR lower(batch) = lower($3))
        AND ($4::text IS NULL OR $4 = ANY(tags))
      ORDER BY part, pk`,
    values: [
      idFilter(query, 'part'),
      flag(query, 'include_variants', true),
      query.get('batch'),
      query.get('tags__name'),
    ],
  }
}

function modelScoped(table: string, order: string) {
  return (query: URLSearchParams): MatchPage => ({
    sql: `
      SELECT * FROM ${table}
      WHERE ($1::text IS NULL OR model_type = $1)
        AND ($2::bigint IS NULL OR model_id = $2)
      ORDER BY ${order}, pk`,
    values: [query.get('model_type'), idFilter(query, 'model_id')],
  })
}

/** An unknown category skips the filter; a known one includes its ancestors' mappings. */
function categoryParameters(query: URLSearchParams): MatchPage {
  return {
    sql: `
      WITH RECURSIVE lineage AS (
        SELECT pk, parent FROM fake_match_category WHERE pk = $1::bigint
        UNION
        SELECT category.pk, category.parent
        FROM fake_match_category category JOIN lineage ON category.pk = lineage.parent
      )
      SELECT * FROM fake_match_category_parameter
      WHERE NOT EXISTS (SELECT 1 FROM lineage)
         OR category IN (SELECT pk FROM lineage)
      ORDER BY pk`,
    values: [idFilter(query, 'category')],
  }
}

const MATCH_LIST_ROUTES: Record<string, (query: URLSearchParams) => MatchPage> = {
  '/api/part/': partSearch,
  '/api/company/part/manufacturer/': manufacturerParts,
  '/api/company/part/': supplierParts,
  '/api/stock/': stockItems,
  '/api/parameter/': modelScoped('fake_match_parameter', 'template'),
  '/api/attachment/': modelScoped('fake_match_attachment', 'upload_date'),
  '/api/part/category/parameters/': categoryParameters,
}

async function matchRows(
  pool: Pool,
  path: string,
  query: URLSearchParams,
  rows: Record<string, unknown>[],
) {
  if (path === '/api/part/') {
    return rows.map(fullPart)
  }
  const partDetail = flag(query, 'part_detail', path === '/api/stock/')
  const parts = partDetail ? await partsByPk(pool, rows.map((row) => row.part)) : new Map()
  const detail = (row: Record<string, unknown>) =>
    partDetail ? { part_detail: briefPart(parts.get(String(row.part))) } : {}
  if (path === '/api/company/part/manufacturer/') {
    const company = flag(query, 'manufacturer_detail', false)
    return rows.map((row) => {
      const manufacturer = { pk: Number(row.manufacturer), name: row.manufacturer_name }
      return {
        pk: Number(row.pk),
        part: Number(row.part),
        MPN: row.mpn,
        manufacturer: Number(row.manufacturer),
        ...(company ? { manufacturer_detail: manufacturer } : {}),
        ...detail(row),
      }
    })
  }
  if (path === '/api/company/part/') {
    const company = flag(query, 'supplier_detail', false)
    return rows.map((row) => {
      const supplier = { pk: Number(row.supplier), name: row.supplier_name }
      return {
        pk: Number(row.pk),
        part: Number(row.part),
        SKU: row.sku,
        supplier: Number(row.supplier),
        ...(company ? { supplier_detail: supplier } : {}),
        ...detail(row),
      }
    })
  }
  if (path === '/api/stock/') {
    return rows.map((row) => ({
      pk: Number(row.pk),
      part: Number(row.part),
      batch: row.batch,
      // InvenTree serializes quantity as a JSON number.
      quantity: Number(row.quantity),
      ...detail(row),
    }))
  }
  if (path === '/api/parameter/') {
    return rows.map((row) => ({
      pk: Number(row.pk),
      template: Number(row.template),
      model_type: row.model_type,
      model_id: Number(row.model_id),
      data: row.data,
    }))
  }
  if (path === '/api/attachment/') {
    return rows.map((row) => ({
      pk: Number(row.pk),
      model_type: row.model_type,
      model_id: Number(row.model_id),
      attachment: row.attachment,
      link: row.link,
      comment: row.comment,
      upload_date: (row.upload_date as Date).toISOString().slice(0, 10),
    }))
  }
  return rows.map((row) => ({
    pk: Number(row.pk),
    category: Number(row.category),
    template: Number(row.template),
    default_value: row.default_value,
  }))
}

async function matchList(pool: Pool, path: string, query: URLSearchParams) {
  const page = MATCH_LIST_ROUTES[path](query)
  let rows: Record<string, unknown>[]
  try {
    rows = (await pool.query(page.sql, page.values)).rows
  } catch (error) {
    if ((error as { code?: string }).code !== UNDEFINED_TABLE) {
      throw error
    }
    rows = []
  }
  const results = await matchRows(pool, path, query, rows)
  const limit = query.get('limit')
  // Without a limit InvenTree returns a bare array of every row.
  if (limit === null) {
    return results
  }
  const offset = Number(query.get('offset') ?? '0')
  return {
    count: results.length,
    next: null,
    previous: null,
    results: results.slice(offset, offset + Number(limit)),
  }
}

/** A seeded single record, or null so the existing routes keep answering unseeded ones. */
async function matchRecord(pool: Pool, url: string) {
  const part = /^\/api\/part\/([1-9][0-9]*)\/$/.exec(url)
  const category = /^\/api\/part\/category\/([1-9][0-9]*)\/$/.exec(url)
  if (!part && !category) {
    return null
  }
  const table = part ? 'fake_match_part' : 'fake_match_category'
  let row: Record<string, unknown> | undefined
  try {
    row = (await pool.query(`SELECT * FROM ${table} WHERE pk = $1`, [(part ?? category)![1]]))
      .rows[0]
  } catch (error) {
    if ((error as { code?: string }).code !== UNDEFINED_TABLE) {
      throw error
    }
    return null
  }
  if (!row) {
    return null
  }
  if (part) {
    return fullPart(row)
  }
  return {
    pk: Number(row.pk),
    name: row.name,
    parent: row.parent === null ? null : Number(row.parent),
    structural: false,
  }
}

/**
 * Match's list reads and seeded single records. The `?limit=1` probe and every other route keep
 * their existing answers.
 */
async function matchFakeRequest(
  pool: Pool,
  request: IncomingMessage,
  response: ServerResponse,
  fault: string,
): Promise<boolean> {
  if (request.url === '/api/part/?limit=1') {
    return false
  }
  const url = new URL(request.url ?? '/', 'http://inventory-fake.invalid')
  const listed = Object.hasOwn(MATCH_LIST_ROUTES, url.pathname)
  let body: unknown
  try {
    body = listed
      ? await matchList(pool, url.pathname, url.searchParams)
      : await matchRecord(pool, request.url ?? '/')
  } catch (error) {
    if (!(error instanceof FakeBadRequest)) {
      throw error
    }
    response.writeHead(400, { 'content-type': 'application/json' }).end('{}')
    return true
  }
  if (body === null) {
    return false
  }
  if (fault === 'read_unavailable') {
    response.writeHead(503, { 'content-type': 'application/json' }).end('{}')
    return true
  }
  response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body))
  return true
}
