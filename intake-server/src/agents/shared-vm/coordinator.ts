import { checkServerIdentity, createServer, type TLSSocket } from 'node:tls'
import { setTimeout as delay } from 'node:timers/promises'
import type { Socket } from 'node:net'
import { once } from 'node:events'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import type { SessionDriver } from '../session-runner.ts'
import { ResearchReapPendingError } from '../../research/errors.ts'
import { Frames, protocol, readBounded } from './frames.ts'
import { SessionResumeUnavailable } from '../session-adapters.ts'
import { NativeSessionError } from '../failure-model.ts'
import { pairing } from './pair.ts'

/** A guest connection accepts exactly one session turn. The capability stays on the host. */
export async function startSessionBridge(directory: string, port: number) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('invalid_bridge_port')
  }
  const idle = new Map<TLSSocket, Frames>()
  const subscriptions = new WeakSet<TLSSocket>()
  const connected = new Set<TLSSocket>()
  const server = createServer(
    { ...(await pairing(directory)), requestCert: true },
    async (socket) => {
      if (
        !socket.authorized ||
        checkServerIdentity('bench-guest', socket.getPeerCertificate()) ||
        connected.size >= 8
      ) {
        socket.destroy()
        return
      }
      connected.add(socket)
      socket.once('close', () => {
        connected.delete(socket)
        idle.delete(socket)
      })
      socket.on('error', () => socket.destroy())
      socket.setTimeout(60_000, () => socket.destroy())
      try {
        const frames = new Frames(socket)
        const greeting = await frames.read()
        if (greeting.claudeSubscription === true) {
          subscriptions.add(socket)
        }
        if (greeting.ready !== protocol) {
          throw new Error('runner_protocol_mismatch')
        }
        socket.setTimeout(0) // The greeting deadline ends once the peer is admitted.
        idle.set(socket, frames)
      } catch {
        socket.destroy()
      }
    },
  )
  const transports = new Set<Socket>()
  server.maxConnections = 16
  server.on('connection', (socket) => {
    transports.add(socket)
    socket.once('close', () => transports.delete(socket))
  })
  server.listen(port, '127.0.0.1')
  await once(server, 'listening')

  const driver: SessionDriver = async (turn, context) => {
    const deadline = Date.now() + 15000
    const subscription =
      context.manifest.profile_id === 'shared-vm-agent/1' &&
      context.manifest.agent?.provider === 'claude' &&
      context.manifest.agent.authentication === 'subscription'

    const available = () => [...idle].find(([socket]) => subscriptions.has(socket) === subscription)

    let connection = available()
    while (!connection && Date.now() < deadline) {
      await delay(100, undefined, { signal: context.signal })
      connection = available()
    }
    if (!connection) {
      if (subscription) {
        throw new NativeSessionError('agent_login_required')
      }
      throw new Error('paired_guest_unavailable')
    }
    const [socket, frames] = connection
    idle.delete(socket)
    const client = new Client({ name: 'shared-vm', version: '1' })

    const stop = () => socket.destroy()

    context.signal.addEventListener('abort', stop, { once: true })
    const deliveredItems = new Set<string>()
    let dispatched = false
    try {
      if (context.manifest.profile_id === 'synthetic-session/1') {
        await client.connect(
          new StreamableHTTPClientTransport(new URL(turn.toolUrl), {
            requestInit: { headers: { Authorization: 'Bearer ' + turn.capability } },
          }),
        )
      }
      context.signal.throwIfAborted()
      dispatched = true
      await frames.send({
        protocol,
        ...context.identity,
        manifest: context.manifest,
        resume: turn.resume,
        instructions: turn.instructions,
        text: turn.text,
        tools: turn.tools,
      })
      for (;;) {
        const msg = await frames.read()
        context.signal.throwIfAborted()
        if (msg.failure === 'resume_unavailable') {
          dispatched = false
          throw new SessionResumeUnavailable()
        }
        if (msg.failure === 'agent_login_required' || msg.failure === 'agent_turn_failed') {
          dispatched = false
          throw new NativeSessionError(msg.failure)
        }
        if (
          msg.provider &&
          typeof msg.provider === 'object' &&
          'providerSessionId' in msg.provider &&
          'actualModel' in msg.provider
        ) {
          const { providerSessionId, actualModel } = msg.provider
          if (
            typeof providerSessionId !== 'string' ||
            providerSessionId.length > 256 ||
            typeof actualModel !== 'string' ||
            actualModel.length > 256
          ) {
            throw new Error('invalid_provider_identity')
          }
          await turn.onStarted({ providerSessionId, actualModel })
          await frames.send({ ok: true })
          continue
        }
        if (msg.nextDelivery === true) {
          const item = await turn.nextDelivery()
          if (item) {
            deliveredItems.add(item.seq.toString())
          }
          await frames.send(item ? { text: item.text, seq: item.seq.toString() } : {})
          continue
        }
        if (msg.progress === true) {
          if (typeof msg.delivered === 'string' && deliveredItems.has(msg.delivered)) {
            turn.onDelivered(BigInt(msg.delivered))
          }
          if (typeof msg.version === 'string' && /^[0-9.]{1,32}$/.test(msg.version)) {
            turn.onCliVersion?.(msg.version)
          }
          await frames.send({ ok: true })
          continue
        }
        if (typeof msg.mcp === 'string' && context.manifest.profile_id === 'shared-vm-agent/1') {
          const response = await fetch(turn.toolUrl, {
            method: 'POST',
            redirect: 'error',
            signal: context.signal,
            headers: {
              Authorization: 'Bearer ' + turn.capability,
              'content-type': 'application/json',
              accept: 'application/json, text/event-stream',
            },
            body: msg.mcp,
          })
          await frames.send({
            status: response.status,
            body: response.body
              ? await readBounded(response.body as unknown as AsyncIterable<Uint8Array>)
              : '',
          })
          continue
        }
        if (msg.done === true) {
          return
        }
        if (msg.started === true && context.manifest.profile_id === 'synthetic-session/1') {
          await turn.onStarted({
            providerSessionId: 'synthetic-' + context.manifest.batch_id,
            actualModel: 'synthetic',
          })
          await frames.send({ ok: true })
          continue
        }
        if (
          context.manifest.profile_id !== 'synthetic-session/1' ||
          typeof msg.tool !== 'string' ||
          !turn.tools.includes(msg.tool) ||
          !msg.args ||
          typeof msg.args !== 'object' ||
          Array.isArray(msg.args)
        ) {
          throw new Error('runner_tool_refused')
        }
        const result = await client.callTool({
          name: msg.tool,
          arguments: msg.args as Record<string, unknown>,
        })
        await frames.send({ result: result.structuredContent })
      }
    } catch (error) {
      if (dispatched) {
        throw new ResearchReapPendingError()
      }
      throw error
    } finally {
      context.signal.removeEventListener('abort', stop)
      socket.destroy()
      await client.close()
    }
  }

  return {
    driver,
    close() {
      for (const socket of transports) {
        socket.destroy()
      }
      server.close()
    },
  }
}
