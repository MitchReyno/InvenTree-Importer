import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SessionInputDto } from '@invimport/contracts'
import { Frames } from '#/agents/shared-vm/frames.ts'
import { isolatedToolTurnAt } from '#/agents/shared-vm/tool-client.ts'
import type { SessionDriverContext } from '#/agents/session/session-runner.ts'

/** Relays one turn from a fake tool worker that sends `requests`, and returns what reached the coordinator. */
async function relay(requests: Record<string, unknown>[]) {
  const root = await mkdtemp(join(tmpdir(), 'tool-client-'))
  const socketPath = join(root, 'worker.sock')
  const worker = createServer((socket: Socket) => {
    const frames = new Frames(socket)
    void (async () => {
      await frames.read()
      for (const request of requests) {
        await frames.send({ request })
        await frames.read()
      }
      await frames.send({ outcome: 'done' })
    })().catch(() => socket.destroy())
  })
  worker.listen(socketPath)
  await once(worker, 'listening')
  const forwarded: Record<string, unknown>[] = []
  try {
    // The relay forwards the manifest unread apart from its provider, so this stand-in names only
    // that; a full sealed input would add nothing the relay checks.
    const manifest = { agent: { provider: 'claude' } } as unknown as SessionInputDto
    const context: SessionDriverContext = {
      manifest,
      cwd: root,
      signal: AbortSignal.timeout(5000),
      identity: { attemptId: 'a', turn: '1', lineage: 'l' },
    }
    await isolatedToolTurnAt(socketPath)(
      context,
      { text: 'Opening', instructions: 'Rules', tools: [] },
      async (operation) => {
        forwarded.push(operation)
        return { ok: true }
      },
    )
    return forwarded
  } finally {
    worker.close()
    await rm(root, { recursive: true, force: true })
  }
}

test("a tool worker's effort report reaches the coordinator through the supervisor", async () => {
  assert.deepEqual(await relay([{ sentEffort: 'max' }]), [{ sentEffort: 'max' }])
})

test('a tool worker operation outside the turn operations is refused', async () => {
  await assert.rejects(relay([{ settings: {} }]), /tool_worker_refused/)
})
