import { createServer } from 'node:http'
import { createHash, timingSafeEqual } from 'node:crypto'
import { credentialStore } from './claude-credential.ts'

import type { CodexAccount } from './codex-login.ts'

export const credentialPath = '/personal-runner/claude'

const digest = (s: string) => createHash('sha256').update(s).digest()

export function managementServer(
  directory: string,
  origin: string,
  key: string,
  codex?: CodexAccount,
) {
  const url = new URL(origin)
  if (
    url.origin !== origin ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) ||
    !/^[a-f0-9]{64}$/.test(key)
  ) {
    throw new Error('invalid_personal_management_configuration')
  }
  const store = codex ? undefined : credentialStore(directory)
  const expected = digest('Bearer ' + key)
  const server = createServer({ requestTimeout: 10000, maxHeaderSize: 8192 }, async (req, res) => {
    res.setHeader('cache-control', 'no-store')
    res.setHeader('content-type', 'application/json')
    res.setHeader('x-content-type-options', 'nosniff')

    const fail = (status: number) => res.writeHead(status).end('{}')

    if (req.url !== (codex ? '/personal-runner/codex' : credentialPath) || req.method !== 'POST') {
      return void fail(404)
    }
    if (
      req.headers.origin !== origin ||
      req.headers['content-type'] !== 'application/json' ||
      !timingSafeEqual(expected, digest(req.headers.authorization ?? ''))
    ) {
      return void fail(403)
    }
    try {
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of req) {
        size += chunk.length
        if (size > 4096) {
          return void fail(413)
        }
        chunks.push(chunk)
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (codex) {
        try {
          res.end(JSON.stringify(await codex.action(body?.action, body?.loginId)))
        } catch {
          fail(409)
        }
        return
      }
      if (!store) {
        return void fail(503)
      }
      if (body?.action !== 'status') {
        if (
          !['remove', 'save'].includes(body?.action) ||
          typeof body.revision !== 'string' ||
          (body.action === 'save' &&
            !/^sk-ant-oat01-[A-Za-z0-9_-]{10,2048}$/.test(
              typeof body.token === 'string' ? body.token : '',
            ))
        ) {
          return void fail(400)
        }
        if (!store.change(body.revision, body.action === 'save' ? body.token : null)) {
          return void fail(409)
        }
      }
      res.end(JSON.stringify(store.status()))
    } catch {
      fail(400)
    }
  })
  server.once('close', () => store?.close())
  return server
}
