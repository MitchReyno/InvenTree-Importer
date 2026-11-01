import { createServer } from './api/server.ts'
import { devConfig } from './config.ts'
import { database } from './db/database.ts'
import { registerCapture } from './capture/routes.ts'
import { captureRead } from './capture/read.ts'
import { inventoryTransport } from './inventory/transport.ts'
import fastifyStatic from '@fastify/static'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const config = devConfig(process.env)
const server = createServer(config)
if (process.env.INTAKE_DATABASE_URL) {
  const db = database(process.env.INTAKE_DATABASE_URL)
  server.addHook('onClose', () => db.close())
  // Only the read closure crosses the capture boundary. No browser-supplied origin/key.
  const transport =
    process.env.INTAKE_READ_ORIGIN && config.apiKey
      ? inventoryTransport({
          kind: 'protected-read-only',
          origin: process.env.INTAKE_READ_ORIGIN,
          targetId: config.targetId,
          contextId: config.targetContextId,
          protectedOrigins: [process.env.INTAKE_READ_ORIGIN],
          credential: config.apiKey,
        })
      : undefined
  await registerCapture(
    server,
    db.pool,
    config,
    transport
      ? captureRead((op) =>
          transport.read({ targetId: config.targetId, contextId: config.targetContextId }, op),
        )
      : undefined,
  )
}
const assets = fileURLToPath(new URL('../../frontend/dist/', import.meta.url))
if (existsSync(assets))
  await server.register(fastifyStatic, { root: assets, index: 'index.html', dotfiles: 'deny' })
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void server.close()
  })
await server.listen({ host: '127.0.0.1', port: Number(new URL(config.origin).port) || 80 })
process.stdout.write('Bench Intake development API listening on configured loopback origin.\n')
