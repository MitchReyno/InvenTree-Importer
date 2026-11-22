import { evidenceRequest } from './evidence-request.ts'
import { ResearchReapPendingError } from '#/research/errors.ts'
import { workerOutcomeError } from './worker-outcome.ts'
import { connect } from 'node:net'
import { once } from 'node:events'
import { evidenceReplyLimit, Frames } from './frames.ts'
import type { nativeTurn } from './native-turn.ts'

/** The tool worker can use only the coordinator operations of its assigned turn. */
export const isolatedToolTurn: typeof nativeTurn = async (context, opening, request) => {
  context.signal.throwIfAborted()
  const socket = connect({ path: '/run/turn/worker.sock', signal: context.signal })
  try {
    await once(socket, 'connect')
    const frames = new Frames(socket)
    await frames.send({ manifest: context.manifest, identity: context.identity, opening })
    for (;;) {
      const message = await frames.read().catch(() => {
        throw new ResearchReapPendingError()
      })
      if (message.outcome === 'done') {
        return
      }
      const failure = workerOutcomeError(message, context.manifest.agent?.provider)
      if (failure) {
        throw failure
      }
      const body = message.request
      if (
        !body ||
        typeof body !== 'object' ||
        Array.isArray(body) ||
        !Object.keys(body).every((key) =>
          ['mcp', 'nextDelivery', 'provider', 'progress', 'version', 'delivered'].includes(key),
        )
      ) {
        throw new Error('tool_worker_refused')
      }
      const operation = body as Record<string, unknown>
      await frames.send(
        await request(operation),
        evidenceRequest(operation.mcp) ? evidenceReplyLimit : undefined,
      )
    }
  } finally {
    socket.destroy()
  }
}
