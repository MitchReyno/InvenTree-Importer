import { createServer } from './api/server.ts'
import { devConfig } from './config.ts'

const config = devConfig(process.env)
const server = createServer(config)
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void server.close() })
await server.listen({ host: '127.0.0.1', port: Number(new URL(config.origin).port) || 80 })
process.stdout.write('Bench Intake development API listening on configured loopback origin.\n')
