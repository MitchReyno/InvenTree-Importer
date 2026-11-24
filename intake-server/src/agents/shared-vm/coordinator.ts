import { TurnEvidenceReleases } from './evidence-release.ts'
import { evidenceRequest } from './evidence-request.ts'
import { checkServerIdentity, createServer, type TLSSocket } from 'node:tls'
import { setTimeout as delay } from 'node:timers/promises'
import type { Socket } from 'node:net'
import { once } from 'node:events'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import type { SessionDriver } from '#/agents/session/session-runner.ts'
import { ResearchReapPendingError } from '#/research/errors.ts'
import { evidenceReplyLimit, Frames, protocol, readBounded } from './frames.ts'
import { SessionResumeUnavailable } from '#/agents/session/session-adapters.ts'
import { NativeSessionError, retainedCause, retainedProviderError } from '#/agents/failure-model.ts'
import { refusalOutcome } from './journal.ts'
import { pairing } from './pair.ts'
import { settled } from '#/events/settled.ts'

export interface SessionBridgeOptions {
  /** Hosts each tool turn's egress proxy refuses; see `bridgeProtectedHosts`. */
  confirmEvidence?: (job: string, version: string) => void
  protectedHosts: readonly string[]
}

/** The failure code a settled guest turn reports, or undefined for anything else. */
function settledFailure(value: unknown) {
  if (value === 'agent_login_required' || value === 'agent_turn_failed') {
    return value
  }
  return refusalOutcome(value)
}

/**
 * A guest connection accepts exactly one session turn. The capability stays on the host. Without
 * `options` the bridge refuses tool turns, whose egress needs the deployment's protected hosts.
 */
export async function startSessionBridge(
  directory: string,
  port: number,
  options?: SessionBridgeOptions,
) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('invalid_bridge_port')
  }
  const idle = new Map<TLSSocket, Frames>()
  const rich = new WeakSet<TLSSocket>()
  const reapPeers = new WeakSet<TLSSocket>()
  const probePeers = new WeakSet<TLSSocket>()
  const subscriptions = new WeakMap<TLSSocket, string>()
  const connected = new Set<TLSSocket>()
  const server = createServer(
    { ...(await pairing(directory)), requestCert: true },
    settled(
      async (socket: TLSSocket) => {
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
          if (
            greeting.reapProof === true &&
            greeting.builtinTools === true &&
            greeting.terminalProbe === true
          ) {
            reapPeers.add(socket)
          }
          if (greeting.terminalProbe === true) {
            probePeers.add(socket)
          }
          if (greeting.claudeSubscription === true) {
            subscriptions.set(socket, 'claude')
          }
          if (greeting.codexSubscription === true) {
            subscriptions.set(socket, 'codex')
          }
          if (greeting.builtinTools === true) {
            // An older tool-worker supervisor would ignore protected_hosts and the sealed web
            // setting, so it never receives a command.
            if (greeting.turnPolicy !== true) {
              throw new Error('runner_turn_policy_unsupported')
            }
            if (greeting.evidenceRelease !== 1 || greeting.evidenceFiles !== true) {
              throw new Error('runner_evidence_release_unsupported')
            }
            rich.add(socket)
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
      // A failure the handler did not catch drops this peer, not the coordinator.
      (_error, socket) => socket.destroy(),
    ),
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
    const toolWorker = context.manifest.profile_id === 'shared-vm-agent/3'
    if (toolWorker && !options) {
      throw new Error('protected_hosts_required')
    }
    // The tool relay starts its provider tunnel, worker and paired supervisor on a cold VM.
    const deadline = Date.now() + (toolWorker ? 45_000 : 15_000)
    const subscription =
      (context.manifest.profile_id === 'shared-vm-agent/1' ||
        context.manifest.profile_id === 'shared-vm-agent/3') &&
      context.manifest.agent?.authentication === 'subscription'
        ? context.manifest.agent.provider
        : undefined

    const available = (probe = false, reap = false) =>
      [...idle].find(
        ([socket]) =>
          (!probe || probePeers.has(socket)) &&
          (!reap || reapPeers.has(socket)) &&
          subscriptions.get(socket) === subscription &&
          rich.has(socket) === toolWorker,
      )

    let connection = available()
    while (!connection && Date.now() < deadline) {
      await delay(100, undefined, { signal: context.signal })
      connection = available()
    }
    if (!connection) {
      if (toolWorker) {
        throw new NativeSessionError('agent_process_unavailable')
      }
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
    const releases = new TurnEvidenceReleases()
    const command = {
      protocol,
      ...context.identity,
      manifest: context.manifest,
      resume: turn.resume,
      instructions: turn.instructions,
      text: turn.text,
      tools: turn.tools,
      ...(toolWorker ? { protected_hosts: options!.protectedHosts, evidenceRelease: 1 } : {}),
    }
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
      await frames.send(command)
      for (;;) {
        const msg = await frames.read()
        context.signal.throwIfAborted()
        if (msg.failure === 'resume_unavailable') {
          dispatched = false
          throw new SessionResumeUnavailable()
        }
        const failure = settledFailure(msg.failure)
        if (failure) {
          dispatched = false
          // Only a listed kind survives; anything else from the guest becomes `unknown`.
          throw new NativeSessionError(failure, {
            providerError: retainedProviderError(
              context.manifest.agent?.provider,
              msg.provider_error,
            ),
            cause: retainedCause(msg.cause),
          })
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
        if ('releaseId' in msg) {
          if (!toolWorker || !options?.confirmEvidence) {
            throw new Error('unexpected_evidence_release')
          }
          releases.confirm(msg.releaseId, (version) =>
            options.confirmEvidence!(context.identity.lineage, version),
          )
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
        if (
          typeof msg.mcp === 'string' &&
          (context.manifest.profile_id === 'shared-vm-agent/1' ||
            context.manifest.profile_id === 'shared-vm-agent/3')
        ) {
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
          const maxBytes = toolWorker && evidenceRequest(msg.mcp) ? evidenceReplyLimit : undefined
          const body = response.body
            ? await readBounded(response.body as unknown as AsyncIterable<Uint8Array>, maxBytes)
            : ''
          const fetchRequest = evidenceRequest(msg.mcp)
          const envelope =
            toolWorker && response.status === 200 && fetchRequest
              ? releases.prepare(fetchRequest.id, body)
              : {}
          await frames.send({ status: response.status, body, ...envelope }, maxBytes)
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
        socket.destroy()
        const cancelled = context.signal.aborted
        if (cancelled && reapPeers.has(socket)) {
          // Cancellation has already closed the original connection. Wait only for a proof
          // from the VM-side launcher, independently bounded from the cancelled operation.
          const proof = await probeTerminal(
            () => available(true, true),
            idle,
            command,
            AbortSignal.timeout(45_000),
            true,
          )
          if (proof === 'worker_removed') {
            throw new NativeSessionError('agent_process_failed')
          }
        } else if (!cancelled && probePeers.has(socket)) {
          // The replacement relay only reads the exact turn journal. A missing or partial
          // record leaves the original interruption path in control.
          const outcome = await probeTerminal(available, idle, command, context.signal)
          if (outcome === 'done') {
            return
          }
          if (outcome === 'resume_unavailable') {
            throw new SessionResumeUnavailable()
          }
          const failure = settledFailure(outcome)
          if (failure) {
            throw new NativeSessionError(failure)
          }
        }
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

async function probeTerminal(
  available: (probe: boolean) => [TLSSocket, Frames] | undefined,
  idle: Map<TLSSocket, Frames>,
  command: Record<string, unknown>,
  signal: AbortSignal,
  requireReap = false,
) {
  const deadline = requireReap ? signal : AbortSignal.any([signal, AbortSignal.timeout(15_000)])
  let claimed: TLSSocket | undefined

  const stop = () => claimed?.destroy()

  try {
    while (!deadline.aborted) {
      const candidate = available(true)
      if (!candidate) {
        await delay(100, undefined, { signal: deadline })
        continue
      }
      const [socket, frames] = candidate
      claimed = socket
      idle.delete(socket)
      deadline.addEventListener('abort', stop, { once: true })
      await frames.send({ inspectTerminal: command, ...(requireReap ? { requireReap: true } : {}) })
      return (await frames.read()).terminalOutcome
    }
  } catch {
    // Only a terminal outcome can release the host claim.
  } finally {
    deadline.removeEventListener('abort', stop)
    claimed?.destroy()
  }
}
