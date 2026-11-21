import { createHash } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Pool } from 'pg'

interface StoredAttachment {
  pk: string
  artifact: string
  stock: string
  sha256: string
  byte_size: string
  media_type: string
  bytes: Buffer
}

export async function initializeAttachmentFake(pool: Pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS fake_attachment (
    pk bigint GENERATED ALWAYS AS IDENTITY (START WITH 8101) PRIMARY KEY,
    artifact uuid NOT NULL,
    stock bigint NOT NULL REFERENCES fake_stock(pk),
    sha256 text NOT NULL,
    byte_size text NOT NULL,
    media_type text NOT NULL,
    bytes bytea NOT NULL
  )`)
}

function metadata(row: StoredAttachment) {
  return {
    capability: 'owned-fake-media/1',
    pk: row.pk,
    artifact: row.artifact,
    stock: row.stock,
    sha256: row.sha256,
    byte_size: row.byte_size,
    media_type: row.media_type,
  }
}

/** Explicit owned fake protocol; this is not an InvenTree attachment compatibility claim. */
export async function attachmentFakeRequest(
  pool: Pool,
  request: IncomingMessage,
  response: ServerResponse,
  bytes: Buffer,
  fault: string,
): Promise<boolean> {
  if (!request.url?.startsWith('/api/stock/attachment/')) {
    return false
  }
  response.setHeader('content-type', 'application/json')
  if (fault === 'attachment_unavailable') {
    response.writeHead(503).end('{}')
    return true
  }
  if (request.method === 'POST' && request.url === '/api/stock/attachment/') {
    const wire = {
      capability: 'owned-fake-media/1',
      artifact: request.headers['x-bench-artifact'],
      stock: request.headers['x-bench-stock'],
      sha256: request.headers['x-bench-sha256'],
      byte_size: request.headers['x-bench-byte-size'],
      media_type: request.headers['x-bench-media-type'],
    }
    const digest = createHash('sha256').update(bytes).digest('hex')
    if (wire.sha256 !== digest || wire.byte_size !== String(bytes.length)) {
      response.writeHead(400).end('{}')
      return true
    }
    if (fault === 'attachment_no_effect') {
      response
        .writeHead(409)
        .end(JSON.stringify({ ...wire, effect: 'none', reason: 'fixture_refusal' }))
      return true
    }
    const stored = await pool.query<StoredAttachment>(
      `INSERT INTO fake_attachment(artifact,stock,sha256,byte_size,media_type,bytes)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [wire.artifact, wire.stock, digest, String(bytes.length), wire.media_type, bytes],
    )
    if (fault === 'attachment_drop_response') {
      response.destroy()
    } else if (fault === 'attachment_malformed') {
      response.writeHead(201).end(JSON.stringify({ pk: stored.rows[0].pk }))
    } else {
      response.writeHead(201).end(JSON.stringify(metadata(stored.rows[0])))
    }
    return true
  }
  const byArtifact = /^\/api\/stock\/attachment\/artifact\/([a-f0-9-]+)\/$/.exec(request.url)
  const byPk = /^\/api\/stock\/attachment\/([1-9][0-9]*)\/(download\/)?$/.exec(request.url)
  if (request.method !== 'GET' || (!byArtifact && !byPk)) {
    response.writeHead(404).end('{}')
    return true
  }
  const result = byArtifact
    ? await pool.query<StoredAttachment>(
        'SELECT * FROM fake_attachment WHERE artifact=$1 ORDER BY pk',
        [byArtifact[1]],
      )
    : await pool.query<StoredAttachment>('SELECT * FROM fake_attachment WHERE pk=$1', [byPk![1]])
  if (result.rows.length !== 1) {
    response.writeHead(result.rows.length ? 409 : 404).end('{}')
    return true
  }
  const row = result.rows[0]
  const receipt = metadata(row)
  if (fault === 'attachment_wrong_destination') {
    receipt.stock = '9999'
  }
  if (byPk?.[2]) {
    const content = Buffer.from(row.bytes)
    if (fault === 'attachment_changed_content') {
      content[Math.floor(content.length / 2)] ^= 1
    }
    response.setHeader('content-type', 'application/octet-stream')
    response.end(Buffer.concat([Buffer.from(JSON.stringify(receipt) + '\n'), content]))
  } else {
    response.end(JSON.stringify(receipt))
  }
  return true
}
