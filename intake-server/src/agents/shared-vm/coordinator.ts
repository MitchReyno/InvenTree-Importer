import { evidenceFormatHeader, TurnEvidenceReleases } from './evidence-release.ts'
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
import {
  guestProviderStatus,
  STATUS_FRAME_LIMIT,
  STATUS_PROTOCOL,
  type GuestProviderStatus,
  type StatusProvider,
} from './provider-status.ts'

export interface SessionBridgeOptions {
  /** Hosts each tool turn's egress proxy refuses; see `bridgeProtectedHosts`. */
  confirmEvidence?: (job: string, version: string) => void
  protectedHosts: readonly string[]
}

/** How long a provider status read may take, and how much of that may go to finding its peer. */
export interface StatusTiming {
  deadlineMs: number
  peerWaitMs: number
}

/** Turn connections the bridge holds, as many as the most sessions that can run at once. */
const MAX_TURN_PEERS = 8
/** Status connections per provider, apart from turns: its relay's, with room for a reconnect. */
const MAX_STATUS_PEERS_PER_PROVIDER = 2
const MAX_STATUS_PEERS = 2 * MAX_STATUS_PEERS_PER_PROVIDER

/** Time a guest's answer needs to arrive once its read has ended. */
const GUEST_ANSWER_MARGIN_MS = 100

/** Under the API's 2 s request, leaving it time to answer. */
const STATUS_TIMING: StatusTiming = { deadlineMs: 1800, peerWaitMs: 500 }

export type BridgeStatusUnknownReason =
  | 'not_configured'
  | 'vm_unreachable'
  | 'service_unavailable'
  | 'guest_outdated'
  | 'busy'
  | 'timeout'

type UnknownStatus = { state: 'unknown'; reason: BridgeStatusUnknownReason }

/** Each provider's status as the coordinator read it; unknown is never signed out. */
export type ClaudeBridgeStatus =
  | { state: 'saved'; revision: string; saved_at: string | null }
  | { state: 'not_saved'; revision: string }
  | UnknownStatus
export type CodexBridgeStatus = { state: 'signed_in' | 'signed_out' | 'signing_in' } | UnknownStatus

export interface BridgeProviderStatuses {
  claude: ClaudeBridgeStatus
  codex: CodexBridgeStatus
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
  statusTiming: StatusTiming = STATUS_TIMING,
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
  const turnSockets = new Set<TLSSocket>()
  const statusSockets = new Set<TLSSocket>()
  const statusProvider = new WeakMap<TLSSocket, StatusProvider>()
  const statusPeers = { claude: new Map<TLSSocket, Frames>(), codex: new Map<TLSSocket, Frames>() }
  // Whether each provider's latest turn guest greeted with the status capability.
  const statusCapable = new Map<StatusProvider, boolean>()
  const server = createServer(
    { ...(await pairing(directory)), requestCert: true },
    settled(
      async (socket: TLSSocket) => {
        if (
          !socket.authorized ||
          checkServerIdentity('bench-guest', socket.getPeerCertificate()) ||
          connected.size >= MAX_TURN_PEERS + MAX_STATUS_PEERS
        ) {
          socket.destroy()
          return
        }
        connected.add(socket)
        socket.once('close', () => {
          connected.delete(socket)
          turnSockets.delete(socket)
          statusSockets.delete(socket)
          idle.delete(socket)
          statusPeers.claude.delete(socket)
          statusPeers.codex.delete(socket)
        })
        socket.on('error', () => socket.destroy())
        socket.setTimeout(60_000, () => socket.destroy())
        try {
          const frames = new Frames(socket)
          const greeting = await frames.read()
          if (greeting.ready === STATUS_PROTOCOL) {
            admitStatusPeer(socket, frames, greeting)
            return
          }
          // Status connections have their own allowance, so they never take a turn's place.
          if (turnSockets.size >= MAX_TURN_PEERS) {
            throw new Error('runner_capacity')
          }
          turnSockets.add(socket)
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
            statusCapable.set('claude', greeting.providerStatus === true)
          }
          if (greeting.codexSubscription === true) {
            subscriptions.set(socket, 'codex')
            statusCapable.set('codex', greeting.providerStatus === true)
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

  /** A status connection carries reads only; it never enters the turn pool. */
  function admitStatusPeer(socket: TLSSocket, frames: Frames, greeting: Record<string, unknown>) {
    const provider = greeting.provider
    if ((provider !== 'claude' && provider !== 'codex') || Object.keys(greeting).length !== 2) {
      throw new Error('runner_protocol_mismatch')
    }
    // Per provider, so one provider's relays never crowd out the other's status.
    const admitted = [...statusSockets].filter((other) => statusProvider.get(other) === provider)
    if (admitted.length >= MAX_STATUS_PEERS_PER_PROVIDER) {
      throw new Error('runner_capacity')
    }
    statusSockets.add(socket)
    statusProvider.set(socket, provider)
    socket.setTimeout(0)
    statusPeers[provider].set(socket, frames)
  }

  function absentReason(provider: StatusProvider): BridgeStatusUnknownReason {
    if (connected.size === 0) {
      return 'vm_unreachable'
    }
    if (statusCapable.get(provider) === false) {
      return 'guest_outdated'
    }
    return 'service_unavailable'
  }

  async function statusPeer(provider: StatusProvider, signal: AbortSignal) {
    const until = Date.now() + statusTiming.peerWaitMs
    for (;;) {
      const peer = statusPeers[provider].entries().next()
      if (!peer.done) {
        statusPeers[provider].delete(peer.value[0])
        return peer.value
      }
      if (Date.now() >= until || signal.aborted) {
        return undefined
      }
      await delay(25, undefined, { signal }).catch(() => {})
    }
  }

  async function readProvider(
    provider: StatusProvider,
    deadlineMs: number,
  ): Promise<ClaudeBridgeStatus | CodexBridgeStatus> {
    const deadline = AbortSignal.timeout(deadlineMs)
    const endsAt = Date.now() + deadlineMs
    const peer = await statusPeer(provider, deadline)
    if (!peer) {
      return { state: 'unknown', reason: absentReason(provider) }
    }
    const [socket, frames] = peer

    // Abandoning the read closes its connection, which stops the guest's work on it.
    const abandon = () => socket.destroy()

    deadline.addEventListener('abort', abandon, { once: true })
    try {
      // The guest finishes, its cleanup included, before this read gives up on it.
      const withinMs = Math.max(0, endsAt - Date.now() - GUEST_ANSWER_MARGIN_MS)
      await frames.send({ status: true, within_ms: withinMs }, STATUS_FRAME_LIMIT)
      const answer = await frames.read(STATUS_FRAME_LIMIT)
      if (!('provider_status' in answer) || Object.keys(answer).length !== 1) {
        throw new Error('invalid_provider_status')
      }
      const status = guestProviderStatus(provider, answer.provider_status)
      deadline.throwIfAborted()
      statusPeers[provider].set(socket, frames)
      return bridgeStatus(status)
    } catch {
      socket.destroy()
      return { state: 'unknown', reason: deadline.aborted ? 'timeout' : 'service_unavailable' }
    } finally {
      deadline.removeEventListener('abort', abandon)
    }
  }

  const reads = new Map<StatusProvider, Promise<ClaudeBridgeStatus | CodexBridgeStatus>>()

  /** Concurrent callers share one read per provider. */
  function sharedRead(provider: StatusProvider, deadlineMs: number) {
    let read = reads.get(provider)
    if (!read) {
      read = readProvider(provider, deadlineMs).finally(() => reads.delete(provider))
      reads.set(provider, read)
    }
    return read
  }

  /** Reads both providers at once, each within its own deadline, shortened to `budgetMs`. */
  async function providerStatus(budgetMs?: number): Promise<BridgeProviderStatuses> {
    const deadlineMs = Math.max(0, Math.min(statusTiming.deadlineMs, budgetMs ?? Infinity))
    const [claude, codex] = await Promise.all([
      sharedRead('claude', deadlineMs),
      sharedRead('codex', deadlineMs),
    ])
    // Each guest answer was checked against its own provider's shapes.
    return { claude: claude as ClaudeBridgeStatus, codex: codex as CodexBridgeStatus }
  }

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
              ? releases.prepare(fetchRequest.id, body, response.headers.get(evidenceFormatHeader))
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
    providerStatus,
    close() {
      for (const socket of transports) {
        socket.destroy()
      }
      server.close()
    },
  }
}

function bridgeStatus(status: GuestProviderStatus): ClaudeBridgeStatus | CodexBridgeStatus {
  switch (status.state) {
    case 'busy':
    case 'timeout':
      return { state: 'unknown', reason: status.state }
    case 'unavailable':
      return { state: 'unknown', reason: 'service_unavailable' }
    case 'saved':
      return { state: status.state, revision: status.revision, saved_at: status.saved_at }
    case 'not_saved':
      return { state: status.state, revision: status.revision }
    case 'signed_in':
    case 'signed_out':
    case 'signing_in':
      return { state: status.state }
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
