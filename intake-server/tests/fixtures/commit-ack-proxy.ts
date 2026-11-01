import { createServer, connect, type Socket } from 'node:net'

/** Transparent owned-PG TCP fault: COMMIT reaches PG; CommandComplete/ReadyForQuery
 * is observed at the proxy but its acknowledgment never reaches the real pg client.
 * No SQL is rewritten, no private PG/scheduler tables and no artificial thrown ACK.
 */
export async function commitAckProxy(databaseUrl: string) {
  const url = new URL(databaseUrl)
  if (url.hostname !== '127.0.0.1' || !url.pathname.startsWith('/intake_test_')) throw new Error('proxy_owned_database_required')
  const upstreamPort = Number(url.port)
  let armed = false, losses = 0
  const sockets = new Set<Socket>()
  const server = createServer(client => {
    const upstream = connect({ host: '127.0.0.1',port: upstreamPort })
    sockets.add(client); sockets.add(upstream)
    let dropping = false, buffer = Buffer.alloc(0)
    client.on('data',bytes => {
      // Query text may be split; the pg COMMIT query is a simple Q message.
      // Hold no client bytes: PG is still the actual transaction authority.
      if (armed && bytes.includes(Buffer.from('COMMIT\0'))) { armed = false; dropping = true }
      upstream.write(bytes)
    })
    upstream.on('data',bytes => {
      if (!dropping) { client.write(bytes); return }
      buffer = Buffer.concat([buffer,bytes])
      while (buffer.length >= 5) {
        const length = buffer.readInt32BE(1) + 1
        if (length < 5 || length > 1024 * 1024) { client.destroy(); upstream.destroy(); return }
        if (buffer.length < length) return
        const message = buffer.subarray(0,length); buffer = buffer.subarray(length)
        if (message[0] === 90) { // ReadyForQuery after committed COMMIT (all its ACK bytes withheld).
          losses++; client.destroy(); upstream.destroy(); return
        }
      }
    })
    const close = () => { client.destroy(); upstream.destroy(); sockets.delete(client); sockets.delete(upstream) }
    client.on('error',close); upstream.on('error',close)
    client.on('close',close); upstream.on('close',close)
  })
  await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('proxy_listener_missing')
  url.hostname = '127.0.0.1'; url.port = String(address.port)
  return { url: url.toString(),dropNextCommit() { armed = true },get losses() { return losses },async close() {
    for (const socket of sockets) socket.destroy()
    await new Promise<void>(resolve => server.close(() => resolve()))
  } }
}
