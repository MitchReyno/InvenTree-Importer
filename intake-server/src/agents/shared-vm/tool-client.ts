import { ResearchReapPendingError } from '../../research/errors.ts'
import { NativeSessionError } from '../failure-model.ts'
import { connect } from 'node:net'
import { once } from 'node:events'
import { Frames } from './frames.ts'
import { SessionResumeUnavailable } from '../session-adapters.ts'
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
      if (message.outcome === 'agent_login_required') {
        throw new NativeSessionError('agent_login_required')
      }
      if (message.outcome === 'done') {
        return
      }
      if (message.outcome === 'resume_unavailable') {
        throw new SessionResumeUnavailable()
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
      await frames.send(await request(body as Record<string, unknown>))
    }
  } finally {
    socket.destroy()
  }
}
