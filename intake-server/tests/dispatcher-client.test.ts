import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DecoderDispatcherBusyError, requestDecode } from '#/media/dispatcher-client.ts'

/** A dispatcher on a private socket that is busy for its first `busy` requests. */
async function dispatcher(busy: number) {
  const root = await mkdtemp(join(tmpdir(), 'dispatch-'))
  const socket = join(root, 'worker.sock')
  let requests = 0
  const server: Server = createServer((req, res) => {
    requests += 1
    req.resume()
    req.on('end', () => {
      if (requests <= busy) {
        res.writeHead(503, { connection: 'close' }).end()
        return
      }
      res.writeHead(200).end('decoded')
    })
  })
  await new Promise<void>((resolve) => server.listen(socket, resolve))
  return {
    socket,
    requests: () => requests,
    close: async () => {
      await new Promise((resolve) => server.close(resolve))
      await rm(root, { recursive: true, force: true })
    },
  }
}

test('a request waits while another decode holds the dispatcher, then runs', async () => {
  const held = await dispatcher(2)
  try {
    const output = await requestDecode(held.socket, 'decoder', Buffer.from('packet'), 5_000)
    assert.equal(output.toString(), 'decoded')
    assert.equal(held.requests(), 3)
  } finally {
    await held.close()
  }
})

test('a dispatcher busy past the wait fails as busy, so the caller knows nothing ran', async () => {
  const held = await dispatcher(Number.POSITIVE_INFINITY)
  try {
    await assert.rejects(
      requestDecode(held.socket, 'decoder', Buffer.from('packet'), 200),
      DecoderDispatcherBusyError,
    )
  } finally {
    await held.close()
  }
})
