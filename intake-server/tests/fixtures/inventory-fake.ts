import { effectsFakeRequest,initializeEffectsFake } from './effects-fake.ts'
import { attachmentFakeRequest, initializeAttachmentFake } from './attachment-fake.ts'
import { createServer } from 'node:http'
import type { Pool } from 'pg'
import { transaction } from '../../src/db/database.ts'

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
    if(effects) {await initializeEffectsFake(pool)}
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
      if(effects && await effectsFakeRequest(pool,request,response,bytes,fault,row.id)) {return}
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
        const tags = match[1] === 'part' && url.searchParams.get('tags') === 'true' ? { tags: [] } : {}
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
    async stocks() {
      return (
        await pool.query('SELECT pk,part,location,quantity,barcode FROM fake_stock ORDER BY pk')
      ).rows
    },
  }
}
