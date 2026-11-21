import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Pool } from 'pg'

export async function initializePartAttachmentFake(pool: Pool) {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS fake_part_attachment(pk bigint GENERATED ALWAYS AS IDENTITY(START WITH 13001) PRIMARY KEY,request_id bigint NOT NULL REFERENCES fake_request(id),part text NOT NULL,filename text NOT NULL,comment text NOT NULL,media_type text NOT NULL,bytes bytea NOT NULL)`,
  )
}

function multipart(bytes: Buffer, contentType: string) {
  const boundary = /^multipart\/form-data; boundary=(bench-[a-f0-9-]+)$/.exec(contentType)?.[1]
  if (!boundary || bytes.length > 20979712) {
    throw new Error('invalid_fake_multipart')
  }
  const marker = Buffer.from(`--${boundary}`)
  const separator = Buffer.from(`\r\n--${boundary}`)
  const fields = new Map<string, Buffer>()
  let filename = ''
  let mediaType = ''
  let cursor = 0
  for (;;) {
    if (!bytes.subarray(cursor, cursor + marker.length).equals(marker)) {
      throw new Error('invalid_fake_multipart')
    }
    cursor += marker.length
    if (bytes.subarray(cursor, cursor + 4).equals(Buffer.from('--\r\n'))) {
      cursor += 4
      break
    }
    if (!bytes.subarray(cursor, cursor + 2).equals(Buffer.from('\r\n'))) {
      throw new Error('invalid_fake_multipart')
    }
    cursor += 2
    const headerEnd = bytes.indexOf(Buffer.from('\r\n\r\n'), cursor)
    if (headerEnd < 0 || headerEnd - cursor > 8192) {
      throw new Error('invalid_fake_multipart')
    }
    const header = bytes.subarray(cursor, headerEnd).toString('utf8')
    const disposition =
      /^Content-Disposition: form-data; name="([a-z_]+)"(?:; filename="(bench-[a-f0-9-]+\.(?:png|jpg|pdf))")?(?:\r\nContent-Type: (image\/png|image\/jpeg|application\/pdf))?$/.exec(
        header,
      )
    if (!disposition || fields.has(disposition[1])) {
      throw new Error('invalid_fake_multipart')
    }
    const end = bytes.indexOf(separator, headerEnd + 4)
    if (end < 0) {
      throw new Error('invalid_fake_multipart')
    }
    fields.set(disposition[1], bytes.subarray(headerEnd + 4, end))
    if (disposition[1] === 'attachment') {
      filename = disposition[2]
      mediaType = disposition[3]
    }
    cursor = end + 2
  }
  if (
    cursor !== bytes.length ||
    [...fields.keys()].sort().join(',') !== 'attachment,comment,model_id,model_type' ||
    fields.get('model_type')!.toString() !== 'part' ||
    !filename ||
    !mediaType
  ) {
    throw new Error('invalid_fake_multipart')
  }
  return {
    part: fields.get('model_id')!.toString(),
    comment: fields.get('comment')!.toString(),
    filename,
    mediaType,
    bytes: fields.get('attachment')!,
  }
}

function metadata(
  row: { pk: string; part: string; filename: string; comment: string; bytes: Buffer },
  fault: string,
) {
  const fields = {
    pk: row.pk,
    model_type: 'part',
    model_id: fault === 'part_attachment_wrong_parent' ? '93' : row.part,
    filename: row.filename,
    comment: row.comment,
    file_size: row.bytes.length,
    attachment:
      fault === 'part_attachment_external'
        ? 'https://outside.invalid/forbidden'
        : `/media/attachments/part/${row.part}/${row.filename}`,
  }
  return fault === 'part_attachment_incomplete' ? { pk: row.pk, filename: row.filename } : fields
}

/** Generic InvenTree1.5.0-shaped multipart/metadata/local-media contract, persisted in the owned fake. */
export async function partAttachmentFakeRequest(
  pool: Pool,
  request: IncomingMessage,
  response: ServerResponse,
  bytes: Buffer,
  fault: string,
  requestId: string,
): Promise<boolean> {
  const path = request.url ?? ''
  if (request.method === 'POST' && path === '/api/attachment/') {
    const value = multipart(bytes, String(request.headers['content-type']))
    const row = (
      await pool.query(
        'INSERT INTO fake_part_attachment(request_id,part,filename,comment,media_type,bytes) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
        [requestId, value.part, value.filename, value.comment, value.mediaType, value.bytes],
      )
    ).rows[0]
    if (fault === 'part_attachment_drop') {
      response.destroy()
      return true
    }
    response
      .writeHead(201, { 'content-type': 'application/json' })
      .end(
        JSON.stringify(
          fault === 'part_attachment_malformed' ? { pk: row.pk } : metadata(row, fault),
        ),
      )
    return true
  }
  const known = /^\/api\/attachment\/([1-9][0-9]*)\/$/.exec(path)
  if (request.method === 'GET' && known) {
    const row = (await pool.query('SELECT * FROM fake_part_attachment WHERE pk=$1', [known[1]]))
      .rows[0]
    response
      .writeHead(row ? 200 : 404, { 'content-type': 'application/json' })
      .end(JSON.stringify(row ? metadata(row, fault) : {}))
    return true
  }
  const file =
    /^\/media\/attachments\/part\/([1-9][0-9]*)\/(bench-[a-f0-9-]+\.(?:pdf|png|jpg))$/.exec(path)
  if (request.method === 'GET' && file) {
    const row = (
      await pool.query('SELECT * FROM fake_part_attachment WHERE part=$1 AND filename=$2', [
        file[1],
        file[2],
      ])
    ).rows[0]
    if (!row) {
      response.writeHead(404).end()
      return true
    }
    if (fault === 'part_attachment_redirect') {
      response.writeHead(307, { location: '/forbidden-redirect-sink' }).end()
      return true
    }
    response.writeHead(200, { 'content-type': row.media_type })
    response.end(
      fault === 'part_attachment_wrong_content'
        ? Buffer.from('different file')
        : fault === 'part_attachment_oversized'
          ? Buffer.alloc(20971521)
          : row.bytes,
    )
    return true
  }
  return false
}
