import { evidenceRequest } from './evidence-request.ts'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { finished } from 'node:stream/promises'
import { once } from 'node:events'
import { randomBytes } from 'node:crypto'
import { stageEvidence, type EvidenceDelivery } from './stage-evidence.ts'
import { readBounded } from './frames.ts'
import { settled } from '#/events/settled.ts'
import { mkdtemp, rm } from 'node:fs/promises'

/** Serializes provider tool responses with their delivery receipts for one guest turn. */
export async function startMcpProxy(
  request: (body: Record<string, unknown>) => Promise<Record<string, unknown>>,
  guestTools: boolean,
  delivery: EvidenceDelivery,
) {
  const capability = randomBytes(32).toString('hex')
  let evidenceDir: Promise<string> | undefined
  let closing = false
  let staging: Promise<string> | undefined
  let pendingMcp = Promise.resolve()
  const proxy = createServer(
    settled(
      async (req: IncomingMessage, res: ServerResponse) => {
        try {
          if (
            req.url !== '/mcp' ||
            req.method !== 'POST' ||
            req.headers.authorization !== 'Bearer ' + capability
          ) {
            res.writeHead(403).end()
            return
          }
          const body = await readBounded(req)

          const deliver = async () => {
            if (closing || res.destroyed) {
              return
            }
            const reply = await request({ mcp: body })
            if (closing || res.destroyed) {
              return
            }
            if (typeof reply.body !== 'string' || typeof reply.status !== 'number') {
              throw new Error('invalid_reply')
            }
            const evidence = guestTools && reply.status === 200 && evidenceRequest(body)
            let responseBody = reply.body
            if (evidence) {
              staging = stageEvidence(
                evidence.id,
                reply.body,
                () => (evidenceDir ??= mkdtemp('/tmp/bench-evidence-')),
                delivery,
                reply.evidenceFormat,
              )
              try {
                responseBody = await staging
              } finally {
                staging = undefined
              }
              if (closing || res.destroyed) {
                return
              }
              if (responseBody !== reply.body && typeof reply.releaseId !== 'string') {
                throw new Error('invalid_evidence_release')
              }
            }
            const written = finished(res, { readable: false, cleanup: true })
            res.writeHead(reply.status, { 'content-type': 'application/json' }).end(responseBody)
            await written
            if (evidence && responseBody !== reply.body) {
              const ack = await request({ releaseId: reply.releaseId })
              if (ack.ok !== true) {
                throw new Error('evidence_release_unconfirmed')
              }
            }
          }

          const operation = pendingMcp.then(deliver)
          pendingMcp = operation.catch(() => {})
          await operation
        } catch {
          if (!res.headersSent && !res.destroyed) {
            res.writeHead(502).end()
          } else {
            res.destroy()
          }
        }
      },
      // A failure the handler did not catch ends this request, not the proxy.
      (_error, _req, res) => res.destroy(),
    ),
  )
  proxy.listen(0, '127.0.0.1')
  await once(proxy, 'listening')
  const address = proxy.address()
  if (!address || typeof address === 'string') {
    throw new Error('missing_address')
  }
  return {
    capability,
    toolUrl: 'http://127.0.0.1:' + address.port + '/mcp',
    // A completed provider may return while its final HTTP response is being confirmed.
    flush: () => pendingMcp,
    async close() {
      closing = true
      proxy.close()
      proxy.closeAllConnections()
      await staging?.catch(() => {})
      if (evidenceDir) {
        await rm(await evidenceDir, { recursive: true, force: true })
      }
    },
  }
}
