import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SessionInputDto } from '@invimport/contracts'
import { evidenceReplyLimit, Frames } from '#/agents/shared-vm/frames.ts'
import { evidenceRequest } from '#/agents/shared-vm/evidence-request.ts'
import { isolatedToolTurnAt } from '#/agents/shared-vm/tool-client.ts'
import type { SessionDriverContext } from '#/agents/session/session-runner.ts'

/**
 * Relays one turn from a fake tool worker that sends `requests`, answering each with `answer`.
 * Returns what reached the coordinator and what the worker read back, read as the tool worker
 * reads it.
 */
async function relay(
  requests: Record<string, unknown>[],
  answer: (operation: Record<string, unknown>) => Record<string, unknown> = () => ({ ok: true }),
) {
  const received: Record<string, unknown>[] = []
  const root = await mkdtemp(join(tmpdir(), 'tool-client-'))
  const socketPath = join(root, 'worker.sock')
  const worker = createServer((socket: Socket) => {
    const frames = new Frames(socket)
    void (async () => {
      await frames.read()
      for (const request of requests) {
        await frames.send({ request })
        received.push(
          await frames.read(evidenceRequest(request.mcp) ? evidenceReplyLimit : undefined),
        )
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
        return answer(operation)
      },
    )
    return { forwarded, received }
  } finally {
    worker.close()
    await rm(root, { recursive: true, force: true })
  }
}

test("a tool worker's effort report reaches the coordinator through the supervisor", async () => {
  const { forwarded } = await relay([{ sentEffort: 'max' }])
  assert.deepEqual(forwarded, [{ sentEffort: 'max' }])
})

test('a tool worker operation outside the turn operations is refused', async () => {
  await assert.rejects(relay([{ settings: {} }]), /tool_worker_refused/)
})

test('a montage reply over the normal frame limit reaches an image tool call in the worker', async () => {
  // Larger than an ordinary 4 MiB frame, within the evidence frame.
  const body = 'm'.repeat(5 * 1024 * 1024)
  const mcp = (name: string) =>
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name } })
  const { received } = await relay(
    [{ mcp: mcp('preview_images') }, { mcp: mcp('match_logo') }, { mcp: mcp('inspect_region') }],
    () => ({ status: 200, body }),
  )
  assert.deepEqual(
    received.map((reply) => reply.body === body),
    [true, true, true],
  )
  // Any other tool keeps the ordinary frame, so the same reply is refused.
  await assert.rejects(
    relay([{ mcp: mcp('read_guide') }], () => ({ status: 200, body })),
    /runner_frame_limit/,
  )
})
