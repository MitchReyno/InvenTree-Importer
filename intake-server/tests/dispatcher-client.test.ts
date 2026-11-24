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

/** A dispatcher with one slot, as `dispatcher-main.ts` has: busy while a decode holds it. */
async function singleSlotDispatcher(holdMs: number) {
  const root = await mkdtemp(join(tmpdir(), 'dispatch-'))
  const socket = join(root, 'worker.sock')
  let busy = false
  const ran: string[] = []
  const server: Server = createServer((req, res) => {
    if (busy) {
      req.resume()
      res.writeHead(503, { connection: 'close' }).end()
      return
    }
    busy = true
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      setTimeout(() => {
        ran.push(Buffer.concat(chunks).toString())
        busy = false
        res.writeHead(200).end('decoded')
      }, holdMs)
    })
  })
  await new Promise<void>((resolve) => server.listen(socket, resolve))
  return {
    socket,
    ran,
    close: async () => {
      await new Promise((resolve) => server.close(resolve))
      await rm(root, { recursive: true, force: true })
    },
  }
}

test('an upload decode waits for a render holding the slot, and a render asks once', async () => {
  const dispatch = await singleSlotDispatcher(300)
  try {
    // A render holds the slot; the upload decode behind it waits and then runs.
    const render = requestDecode(dispatch.socket, 'decoder', Buffer.from('render'), 0)
    await new Promise((resolve) => setTimeout(resolve, 50))
    const upload = requestDecode(dispatch.socket, 'decoder', Buffer.from('upload'))
    assert.equal((await render).toString(), 'decoded')
    assert.equal((await upload).toString(), 'decoded')

    // An upload decode holds the slot; a render asks once and is told it is busy.
    const holding = requestDecode(dispatch.socket, 'decoder', Buffer.from('upload 2'))
    await new Promise((resolve) => setTimeout(resolve, 50))
    await assert.rejects(
      requestDecode(dispatch.socket, 'decoder', Buffer.from('render 2'), 0),
      DecoderDispatcherBusyError,
    )
    await holding
    assert.deepEqual(dispatch.ran, ['render', 'upload', 'upload 2'])
  } finally {
    await dispatch.close()
  }
})
