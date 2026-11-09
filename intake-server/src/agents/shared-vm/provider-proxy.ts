import { connect, createServer } from 'node:net'
import { once } from 'node:events'

export async function providerProxy(provider: 'claude' | 'codex') {
  const server = createServer((local) => {
    const upstream = connect('/run/egress/' + provider + '.sock')
    local.on('error', () => upstream.destroy())
    upstream.on('error', () => local.destroy())
    local.on('close', () => upstream.destroy())
    upstream.on('close', () => local.destroy())
    local.pipe(upstream).pipe(local)
  })
  server.listen(14316, '127.0.0.1')
  await once(server, 'listening')
  return server
}
