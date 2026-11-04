import { initializePartAttachmentFake, partAttachmentFakeRequest } from './part-attachment-fake.ts'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Pool } from 'pg'
import { createHash } from 'node:crypto'

/** Created locations and companies start here; these PKs are served only from stored rows. */
export const FIRST_RECORD_PK = 12001

export async function initializeEffectsFake(pool: Pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS fake_part(pk bigint GENERATED ALWAYS AS IDENTITY(START WITH 8101) PRIMARY KEY,request_id bigint NOT NULL REFERENCES fake_request(id),body jsonb NOT NULL);
  CREATE TABLE IF NOT EXISTS fake_supported(pk bigint GENERATED ALWAYS AS IDENTITY(START WITH 9101) PRIMARY KEY,family text NOT NULL,request_id bigint NOT NULL REFERENCES fake_request(id),body jsonb NOT NULL);
  CREATE TABLE IF NOT EXISTS fake_record(pk bigint GENERATED ALWAYS AS IDENTITY(START WITH ${FIRST_RECORD_PK}) PRIMARY KEY,family text NOT NULL CHECK(family IN ('location','company')),request_id bigint NOT NULL REFERENCES fake_request(id),body jsonb NOT NULL,image_sha256 text);`)
  await initializePartAttachmentFake(pool)
}

/** Version1.5.0-shaped catalogue/effect fields; this remains an owned fake, not compatibility proof. */
export async function effectsFakeRequest(
  pool: Pool,
  request: IncomingMessage,
  response: ServerResponse,
  bytes: Buffer,
  fault: string,
  requestId: string,
): Promise<boolean> {
  if (await partAttachmentFakeRequest(pool, request, response, bytes, fault, requestId)) {
    return true
  }
  const url = new URL(request.url ?? '/', 'http://effects-fake.invalid')
  const path = url.pathname
  // InvenTree's optional `tags` serializer field exists only when the request opts in with ?tags=true.
  const tagsField = url.searchParams.get('tags') === 'true'
  response.setHeader('content-type', 'application/json')
  if (await recordFakeRequest(pool, request, response, path, bytes, fault, requestId)) {
    return true
  }
  const catalogue =
    /^\/api\/(part\/category|parameter\/template|part\/category\/parameters|company)\/([1-9][0-9]*)\/$/.exec(
      path,
    )
  if (request.method === 'GET' && catalogue) {
    const family = catalogue[1]
    const pk = catalogue[2]
    if (
      fault === 'mapping_unavailable' ||
      (fault === 'parameter_read_unavailable' && family === 'parameter/template')
    ) {
      response.writeHead(503).end('{}')
      return true
    }
    const body =
      family === 'part/category'
        ? { pk, name: 'Resistors', structural: false }
        : family === 'parameter/template'
          ? { pk, name: 'Resistance', model_type: 'part.part', enabled: true }
          : family === 'part/category/parameters'
            ? { pk, category: '81', template: '201', default_value: '' }
            : { pk, name: `Company ${pk}`, is_manufacturer: true, is_supplier: true }
    if (fault === 'mapping_incomplete' && family === 'parameter/template') {
      response.end(JSON.stringify({ pk, name: 'Resistance' }))
      return true
    }
    response.end(JSON.stringify(body))
    return true
  }
  const part = /^\/api\/part\/([1-9][0-9]*)\/$/.exec(path)
  if (request.method === 'GET' && part) {
    const row = (await pool.query('SELECT pk,body FROM fake_part WHERE pk=$1', [part[1]])).rows[0]
    if (!row) {
      return false
    }
    const { tags, ...fields } = row.body
    response.end(
      JSON.stringify({ pk: row.pk, ...fields, ...(tagsField ? { tags: tags ?? [] } : {}) }),
    )
    return true
  }
  const endpoints = {
    '/api/part/': 'part',
    '/api/parameter/': 'parameter',
    '/api/company/part/manufacturer/': 'manufacturer',
    '/api/company/part/': 'supplier',
  } as const
  const family = endpoints[path as keyof typeof endpoints]
  if (request.method === 'POST' && family) {
    const requested = JSON.parse(bytes.toString('utf8'))
    const { tags: _ignoredTags, ...withoutTags } = requested
    const body = family === 'part' && !tagsField ? withoutTags : requested
    const row =
      family === 'part'
        ? (
            await pool.query('INSERT INTO fake_part(request_id,body) VALUES($1,$2) RETURNING pk', [
              requestId,
              body,
            ])
          ).rows[0]
        : (
            await pool.query(
              'INSERT INTO fake_supported(family,request_id,body) VALUES($1,$2,$3) RETURNING pk',
              [family, requestId, body],
            )
          ).rows[0]
    if (fault === 'fail_parameter_after_part' && family === 'part') {
      await pool.query("UPDATE fake_control SET fault='parameter_read_unavailable' WHERE id=1")
    }
    if (fault === 'part_drop_response' && family === 'part') {
      response.destroy()
      return true
    }
    response.statusCode = 201
    if (fault === 'part_multiple' && family === 'part') {
      response.end(JSON.stringify([{ pk: row.pk }, { pk: '7777' }, { pk: 'invalid' }]))
      return true
    }
    if (fault === 'part_malformed' && family === 'part') {
      response.end(JSON.stringify({ pk: row.pk }))
      return true
    }
    if (family === 'part') {
      const { tags, ...fields } = body
      response.end(
        JSON.stringify({ pk: row.pk, ...fields, ...(tagsField ? { tags: tags ?? [] } : {}) }),
      )
      return true
    }
    response.end(JSON.stringify({ pk: row.pk, ...body }))
    return true
  }
  const effect =
    /^\/api\/(parameter|company\/part\/manufacturer|company\/part)\/([1-9][0-9]*)\/$/.exec(path)
  if (request.method === 'GET' && effect) {
    const family =
      effect[1] === 'parameter'
        ? 'parameter'
        : effect[1] === 'company/part/manufacturer'
          ? 'manufacturer'
          : 'supplier'
    const row = (
      await pool.query('SELECT pk,body FROM fake_supported WHERE pk=$1 AND family=$2', [
        effect[2],
        family,
      ])
    ).rows[0]
    response.statusCode = row ? 200 : 404
    response.end(JSON.stringify(row ? { pk: row.pk, ...row.body } : {}))
    return true
  }
  return false
}

/** Minimal multipart reader for the owned fake: text fields plus one `image` file. */
function multipartFields(contentType: string, bytes: Buffer) {
  const boundary = /boundary=(bench-[a-f0-9-]+)$/.exec(contentType)?.[1]
  if (!boundary) {
    throw new Error('fake_multipart_invalid')
  }
  const fields: Record<string, string> = {}
  let image: Buffer | null = null
  const marker = Buffer.from(`--${boundary}`)
  let start = bytes.indexOf(marker) + marker.length
  while (start > marker.length - 1) {
    const end = bytes.indexOf(marker, start)
    if (end < 0) {
      break
    }
    const part = bytes.subarray(start + 2, end - 2)
    const split = part.indexOf('\r\n\r\n')
    const headers = part.subarray(0, split).toString('utf8')
    const value = part.subarray(split + 4)
    const name = /name="([^"]+)"/.exec(headers)?.[1]
    if (name === 'image') {
      image = Buffer.from(value)
    } else if (name) {
      fields[name] = value.toString('utf8')
    }
    start = end + marker.length
  }
  return { fields, image }
}

async function recordFakeRequest(
  pool: Pool,
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  bytes: Buffer,
  fault: string,
  requestId: string,
) {
  const created = /^\/api\/(stock\/location|company)\/([1-9][0-9]*)\/$/.exec(path)
  if (request.method === 'GET' && created) {
    const family = created[1] === 'company' ? 'company' : 'location'
    const row = (
      await pool.query('SELECT pk,body FROM fake_record WHERE pk=$1 AND family=$2', [
        created[2],
        family,
      ])
    ).rows[0]
    if (!row && BigInt(created[2]) < BigInt(FIRST_RECORD_PK)) {
      return false
    }
    response.statusCode = row ? 200 : 404
    response.end(JSON.stringify(row ? { pk: row.pk, ...row.body } : {}))
    return true
  }
  const family =
    path === '/api/stock/location/' ? 'location' : path === '/api/company/' ? 'company' : null
  if (request.method !== 'POST' || !family) {
    return false
  }
  let body: Record<string, unknown>
  let imageDigest: string | null = null
  const contentType = String(request.headers['content-type'] ?? '')
  if (contentType.startsWith('multipart/form-data')) {
    const { fields, image } = multipartFields(contentType, bytes)
    imageDigest = image ? createHash('sha256').update(image).digest('hex') : null
    body = {
      ...fields,
      is_supplier: fields.is_supplier === 'true',
      is_manufacturer: fields.is_manufacturer === 'true',
    }
  } else {
    body = JSON.parse(bytes.toString('utf8'))
  }
  const row = (
    await pool.query(
      'INSERT INTO fake_record(family,request_id,body,image_sha256) VALUES($1,$2,$3,$4) RETURNING pk',
      [family, requestId, body, imageDigest],
    )
  ).rows[0]
  if (imageDigest) {
    body = { ...body, image: `/media/company_images/bench-${row.pk}.img` }
    await pool.query('UPDATE fake_record SET body=$2 WHERE pk=$1', [row.pk, body])
  }
  if (fault === 'record_drop_response') {
    response.destroy()
    return true
  }
  response.statusCode = 201
  if (fault === 'record_multiple') {
    response.end(JSON.stringify([{ pk: row.pk }, { pk: '7777' }]))
    return true
  }
  if (fault === 'record_malformed') {
    response.end(JSON.stringify({ pk: row.pk }))
    return true
  }
  response.end(JSON.stringify({ pk: row.pk, ...body }))
  return true
}
