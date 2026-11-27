import { evidenceFormatHeader, TurnEvidenceReleases } from './evidence-release.ts'
import { evidenceRequest } from './evidence-request.ts'
import { checkServerIdentity, createServer, type TLSSocket } from 'node:tls'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer as createTcpServer, type Socket } from 'node:net'
import { once } from 'node:events'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import type { SessionDriver, SessionDriverContext } from '#/agents/session/session-runner.ts'
import { ResearchReapPendingError } from '#/research/errors.ts'
import { evidenceReplyLimit, Frames, protocol, readBounded } from './frames.ts'
import {
  SessionCapacityUnavailable,
  SessionResumeUnavailable,
  type SessionTurn,
} from '#/agents/session/session-adapters.ts'
import { MAX_SESSION_SLOTS, type TurnChild } from '#/agents/session/slots.ts'
import { NativeSessionError, retainedCause, retainedProviderError } from '#/agents/failure-model.ts'
import { refusalOutcome } from './journal.ts'
import { LANE_START, LaneOffers, MAX_OFFER_BYTES, offerRoute, peerKey } from './lane-offers.ts'
import { StartupGate } from './startup-gate.ts'
import { reportedMemory, vmTurnCapacity } from './turn-capacity.ts'
import { pairing } from './pair.ts'
import { settled } from '#/events/settled.ts'
import {
  guestProviderStatus,
  MIN_STATUS_WITHIN_MS,
  STATUS_FRAME_LIMIT,
  STATUS_PROTOCOL,
  type GuestProviderStatus,
  type StatusProvider,
} from './provider-status.ts'
import {
  CATALOG_FRAME_BYTES,
  CATALOG_GENERATION_MS,
  CATALOG_PROTOCOL,
  CATALOG_READ_MS,
  guestCatalogAnswer,
  type GuestCatalogAnswer,
} from './model-catalog.ts'

export interface SessionBridgeOptions {
  /** Hosts each tool turn's egress proxy refuses; see `bridgeProtectedHosts`. */
  /** Grants a confirmed release: the version to the job, and its page to the attempt that saw it. */
  confirmEvidence?: (
    job: string,
    version: string,
    delivered?: { attemptId: string; page: number },
  ) => void
  protectedHosts: readonly string[]
}

/** How long a provider status read may take, and how much of that may go to finding its peer. */
export interface StatusTiming {
  deadlineMs: number
  peerWaitMs: number
}

/** How long a catalogue read and a generation-only read may take, and the wait for a peer. */
export interface CatalogTiming {
  readMs: number
  generationMs: number
  peerWaitMs: number
}

const CATALOG_TIMING: CatalogTiming = {
  readMs: CATALOG_READ_MS,
  // The guest's own bound on a generation read, with room for the answer to arrive.
  generationMs: CATALOG_GENERATION_MS + 1000,
  peerWaitMs: 500,
}

/** What a catalogue request got: the guest's answer, or why there was none. */
export type BridgeCatalogAnswer = GuestCatalogAnswer

/**
 * Turn connections the bridge holds. Busy ones never outnumber the slots, and each relay adds one
 * ready connection; this leaves room for every relay of a deployment beside the slots' turns.
 */
const MAX_TURN_PEERS = 2 * MAX_SESSION_SLOTS
/** Status connections per provider, apart from turns: its relay's, with room for a reconnect. */
const MAX_STATUS_PEERS_PER_PROVIDER = 2
const MAX_STATUS_PEERS = 2 * MAX_STATUS_PEERS_PER_PROVIDER
/** Catalogue connections per provider, apart from turns and status, on the same terms. */
const MAX_CATALOG_PEERS_PER_PROVIDER = 2
const MAX_CATALOG_PEERS = 2 * MAX_CATALOG_PEERS_PER_PROVIDER

/** Time a guest's answer needs to arrive once its read has ended. */
const GUEST_ANSWER_MARGIN_MS = 100

/** Under the API's 2 s request, leaving it time to answer. */
const STATUS_TIMING: StatusTiming = { deadlineMs: 1800, peerWaitMs: 500 }

/**
 * How long a turn waits for a free connection of its route, how long one turn's start may hold
 * the startup gate and how long a turn waits for the gate.
 */
export interface TurnTiming {
  toolWorkerPeerWaitMs: number
  peerWaitMs: number
  startupHoldMs: number
  startupWaitMs: number
  /** How long a guest started for a waiter that has gone may sit idle before it is closed. */
  startedIdleMs: number
}

const TURN_TIMING: TurnTiming = {
  // A tool relay starts its provider tunnel, worker and paired supervisor for each new connection.
  toolWorkerPeerWaitMs: 45_000,
  peerWaitMs: 15_000,
  // The connection wait, the CLI's 45 s admission and a margin.
  startupHoldMs: 120_000,
  // Behind at most a few starts, each bounded by the hold; past it the turn is requeued.
  startupWaitMs: 180_000,
  startedIdleMs: 30_000,
}

/** Open lane offers the coordinator keeps; each relay holds one. */
const MAX_LANE_OFFERS = MAX_SESSION_SLOTS
/** How long a relay has to write its whole offer line. */
const OFFER_LINE_MS = 5_000
/** How long a route waits to start another guest after one closed before it was admitted. */
const LAUNCH_RETRY_MS = 1_000
/** How long a journal probe may take, its guest's start on demand included, as a turn's wait. */
const JOURNAL_PROBE_MS = 45_000
/** The first byte of a TLS handshake record: a guest, status or catalogue connection. */
const TLS_HANDSHAKE = 0x16

export type BridgeStatusUnknownReason =
  | 'not_configured'
  | 'vm_unreachable'
  | 'service_unavailable'
  | 'guest_outdated'
  | 'busy'
  | 'timeout'
  | 'checking'

type UnknownStatus = { state: 'unknown'; reason: BridgeStatusUnknownReason }

/**
 * Each provider's status as the coordinator read it; unknown is never signed out. `checked_at`
 * is when the guest established a known state, on this server's clock.
 */
export type ClaudeBridgeStatus =
  | { state: 'saved'; revision: string; saved_at: string | null; checked_at: string }
  | { state: 'not_saved'; revision: string; checked_at: string }
  | UnknownStatus
export type CodexBridgeStatus =
  | { state: 'signed_in' | 'signed_out' | 'signing_in'; checked_at: string; refreshing: boolean }
  | UnknownStatus

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
  catalogTiming: CatalogTiming = CATALOG_TIMING,
  turnTiming: TurnTiming = TURN_TIMING,
) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('invalid_bridge_port')
  }
  const idle = new Map<TLSSocket, Frames>()
  // Turn connections that reached the idle pool and are still open, idle or busy.
  const admittedTurns = new Set<TLSSocket>()
  // Turn connections ever admitted per route, so a waiter sees one that came and went unsampled.
  const routeAdmissions = new Map<string, number>()
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
  const catalogSockets = new Set<TLSSocket>()
  const catalogPeers = { claude: new Map<TLSSocket, Frames>(), codex: new Map<TLSSocket, Frames>() }
  // Whether each provider's latest turn guest greeted with the model catalogue capability.
  const catalogCapable = new Map<StatusProvider, boolean>()
  const offers = new LaneOffers(MAX_LANE_OFFERS, LAUNCH_RETRY_MS)
  const startupGate = new StartupGate(turnTiming.startupHoldMs)
  // The VM's memory as the latest turn greeting reported it; an older guest reports none.
  let vmMemory: number | undefined
  let loggedCapacity: number | undefined
  const server = createServer(
    { ...(await pairing(directory)), requestCert: true },
    settled(
      async (socket: TLSSocket) => {
        if (
          !socket.authorized ||
          checkServerIdentity('bench-guest', socket.getPeerCertificate()) ||
          connected.size >= MAX_TURN_PEERS + MAX_STATUS_PEERS + MAX_CATALOG_PEERS
        ) {
          socket.destroy()
          return
        }
        connected.add(socket)
        socket.once('close', () => {
          connected.delete(socket)
          turnSockets.delete(socket)
          admittedTurns.delete(socket)
          statusSockets.delete(socket)
          idle.delete(socket)
          statusPeers.claude.delete(socket)
          statusPeers.codex.delete(socket)
          catalogSockets.delete(socket)
          catalogPeers.claude.delete(socket)
          catalogPeers.codex.delete(socket)
        })
        socket.on('error', () => socket.destroy())
        socket.setTimeout(60_000, () => socket.destroy())
        // Started from a lane offer: it counts as starting until it is admitted or closes.
        const peer = peerKey(socket)
        const launched = offers.isStarting(peer)
        try {
          const frames = new Frames(socket)
          const greeting = await frames.read()
          if (greeting.ready === STATUS_PROTOCOL) {
            admitStatusPeer(socket, frames, greeting)
            return
          }
          if (greeting.ready === CATALOG_PROTOCOL) {
            admitCatalogPeer(socket, frames, greeting)
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
            catalogCapable.set('claude', greeting.modelCatalog === true)
          }
          if (greeting.codexSubscription === true) {
            subscriptions.set(socket, 'codex')
            statusCapable.set('codex', greeting.providerStatus === true)
            catalogCapable.set('codex', greeting.modelCatalog === true)
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
          // Only an admitted guest's report counts, so a refused greeting changes no capacity.
          noteMemory(greeting.memoryBytes)
          admittedTurns.add(socket)
          const key = socketRouteKey(socket)
          routeAdmissions.set(key, (routeAdmissions.get(key) ?? 0) + 1)
          idle.set(socket, frames)
          if (launched) {
            offers.admitted(peer)
            closeIfUnclaimed(socket)
          }
        } catch {
          socket.destroy()
        }
      },
      // A failure the handler did not catch drops this peer, not the coordinator.
      (_error, socket) => socket.destroy(),
    ),
  )

  /** Keeps the latest turn greeting's memory report and logs a change in the VM's capacity. */
  function noteMemory(value: unknown) {
    vmMemory = reportedMemory(value)
    const capacity = vmTurnCapacity(vmMemory)
    if (capacity !== loggedCapacity) {
      loggedCapacity = capacity
      const memoryMib = vmMemory === undefined ? null : Math.round(vmMemory / 1024 / 1024)
      process.stderr.write(
        JSON.stringify({ event: 'vm_turn_capacity', memory_mib: memoryMib, turns: capacity }) +
          '\n',
      )
    }
  }

  /** A guest started for a waiter that has since gone doesn't stay up holding its containers. */
  function closeIfUnclaimed(socket: TLSSocket) {
    const timer = setTimeout(() => {
      if (idle.has(socket)) {
        socket.destroy()
      }
    }, turnTiming.startedIdleMs)
    timer.unref()
    socket.once('close', () => clearTimeout(timer))
  }

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

  /** A catalogue connection carries reads only, under its own allowance per provider. */
  function admitCatalogPeer(socket: TLSSocket, frames: Frames, greeting: Record<string, unknown>) {
    const provider = greeting.provider
    if ((provider !== 'claude' && provider !== 'codex') || Object.keys(greeting).length !== 2) {
      throw new Error('runner_protocol_mismatch')
    }
    if (catalogPeers[provider].size + catalogBorrowed[provider] >= MAX_CATALOG_PEERS_PER_PROVIDER) {
      throw new Error('runner_capacity')
    }
    catalogSockets.add(socket)
    socket.setTimeout(0)
    catalogPeers[provider].set(socket, frames)
  }

  // Catalogue connections a request has taken and not yet returned or destroyed, per provider.
  const catalogBorrowed = { claude: 0, codex: 0 }

  function absentCatalog(provider: StatusProvider): BridgeCatalogAnswer {
    if (connected.size === 0) {
      return { kind: 'failure', failure: 'vm_unreachable' }
    }
    if (catalogCapable.get(provider) === false) {
      return { kind: 'failure', failure: 'guest_outdated' }
    }
    return { kind: 'failure', failure: 'unavailable' }
  }

  /** An idle catalogue connection, waited for as `statusPeer` waits for a status one. */
  async function catalogPeer(provider: StatusProvider, signal: AbortSignal, endsAt: number) {
    const shortWaitUntil = Date.now() + catalogTiming.peerWaitMs
    for (;;) {
      const peer = catalogPeers[provider].entries().next()
      if (!peer.done) {
        catalogPeers[provider].delete(peer.value[0])
        catalogBorrowed[provider]++
        return peer.value
      }
      const until = catalogBorrowed[provider] > 0 ? endsAt - GUEST_ANSWER_MARGIN_MS : shortWaitUntil
      if (Date.now() >= until || signal.aborted) {
        return undefined
      }
      await delay(25, undefined, { signal }).catch(() => {})
    }
  }

  /**
   * Asks the guest for a provider's model list (`read`), or only its current sign-in generation,
   * which starts no CLI. A read that runs out closes its connection, which stops the guest's
   * reader; the guest answers `timeout` itself once it has reaped one.
   */
  async function modelCatalog(
    provider: StatusProvider,
    kind: 'read' | 'generation',
    signal?: AbortSignal,
  ): Promise<BridgeCatalogAnswer> {
    const budgetMs = kind === 'read' ? catalogTiming.readMs : catalogTiming.generationMs
    const deadline = AbortSignal.timeout(budgetMs)
    const stopped = AbortSignal.any([deadline, closing.signal, ...(signal ? [signal] : [])])
    const endsAt = Date.now() + budgetMs
    if (stopped.aborted) {
      return { kind: 'failure', failure: 'timeout' }
    }
    const peer = await catalogPeer(provider, stopped, endsAt)
    if (!peer) {
      return stopped.aborted ? { kind: 'failure', failure: 'timeout' } : absentCatalog(provider)
    }
    const [socket, frames] = peer
    // A signal that ended while the peer was taken never fires its listener, so nothing is sent.
    if (stopped.aborted) {
      catalogPeers[provider].set(socket, frames)
      catalogBorrowed[provider]--
      return { kind: 'failure', failure: 'timeout' }
    }

    const abandon = () => socket.destroy()

    stopped.addEventListener('abort', abandon, { once: true })
    try {
      const withinMs = Math.max(0, endsAt - Date.now() - GUEST_ANSWER_MARGIN_MS)
      const request =
        kind === 'read' ? { catalog: 'read', within_ms: withinMs } : { catalog: 'generation' }
      await frames.send(request, CATALOG_FRAME_BYTES)
      const frame = await frames.read(CATALOG_FRAME_BYTES).catch((error: unknown) => {
        // An oversized or unparsable frame; a lost connection is unavailable instead.
        if (error instanceof SyntaxError || (error as Error).message === 'invalid_runner_frame') {
          return undefined
        }
        throw error
      })
      stopped.throwIfAborted()
      const answer = frame ? catalogAnswer(frame, kind) : undefined
      if (!answer) {
        socket.destroy()
        return { kind: 'failure', failure: 'malformed' }
      }
      catalogPeers[provider].set(socket, frames)
      return answer
    } catch {
      socket.destroy()
      return { kind: 'failure', failure: stopped.aborted ? 'timeout' : 'unavailable' }
    } finally {
      stopped.removeEventListener('abort', abandon)
      catalogBorrowed[provider]--
    }
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

  // Status connections a read has taken and not yet returned or destroyed, per provider.
  const borrowed = { claude: 0, codex: 0 }

  /**
   * An idle status connection, waited for briefly when there is none; but one another read has
   * borrowed comes back when that read ends, so it is waited for while this read's own deadline
   * still leaves the guest time to answer.
   */
  async function statusPeer(provider: StatusProvider, signal: AbortSignal, endsAt: number) {
    const shortWaitUntil = Date.now() + statusTiming.peerWaitMs
    const borrowedWaitUntil = endsAt - GUEST_ANSWER_MARGIN_MS - MIN_STATUS_WITHIN_MS
    for (;;) {
      const peer = statusPeers[provider].entries().next()
      if (!peer.done) {
        statusPeers[provider].delete(peer.value[0])
        borrowed[provider]++
        return peer.value
      }
      const until = borrowed[provider] > 0 ? borrowedWaitUntil : shortWaitUntil
      if (Date.now() >= until || signal.aborted) {
        return undefined
      }
      await delay(25, undefined, { signal }).catch(() => {})
    }
  }

  async function readProvider(
    provider: StatusProvider,
    deadlineMs: number,
    refresh: boolean,
  ): Promise<ClaudeBridgeStatus | CodexBridgeStatus> {
    const deadline = AbortSignal.timeout(deadlineMs)
    const endsAt = Date.now() + deadlineMs
    const peer = await statusPeer(provider, deadline, endsAt)
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
      // Only Codex answers from an earlier check; Claude reads its store on every request.
      const request = refresh && provider === 'codex' ? { refresh: true } : {}
      await frames.send({ status: true, within_ms: withinMs, ...request }, STATUS_FRAME_LIMIT)
      const answer = await frames.read(STATUS_FRAME_LIMIT)
      if (!('provider_status' in answer) || Object.keys(answer).length !== 1) {
        throw new Error('invalid_provider_status')
      }
      const status = guestProviderStatus(provider, answer.provider_status)
      deadline.throwIfAborted()
      statusPeers[provider].set(socket, frames)
      return bridgeStatus(status, Date.now())
    } catch {
      socket.destroy()
      return { state: 'unknown', reason: deadline.aborted ? 'timeout' : 'service_unavailable' }
    } finally {
      deadline.removeEventListener('abort', abandon)
      borrowed[provider]--
    }
  }

  const reads = new Map<string, Promise<ClaudeBridgeStatus | CodexBridgeStatus>>()

  /**
   * Concurrent plain callers share one read per provider. A Check again reads anew, waiting for
   * the status connection a read in flight returns.
   */
  function sharedRead(provider: StatusProvider, deadlineMs: number, refresh: boolean) {
    // Check again never joins a read in flight, which may predate a sign-in change.
    if (refresh) {
      return readProvider(provider, deadlineMs, true)
    }
    const key = provider
    let read = reads.get(key)
    if (!read) {
      read = readProvider(provider, deadlineMs, refresh).finally(() => reads.delete(key))
      reads.set(key, read)
    }
    return read
  }

  /**
   * Reads both providers at once, each within its own deadline, shortened to `budgetMs`.
   * `refresh` asks Codex to start a fresh check; its answer still comes from the last one.
   */
  async function providerStatus(
    budgetMs?: number,
    refresh = false,
  ): Promise<BridgeProviderStatuses> {
    const deadlineMs = Math.max(0, Math.min(statusTiming.deadlineMs, budgetMs ?? Infinity))
    const [claude, codex] = await Promise.all([
      sharedRead('claude', deadlineMs, false),
      sharedRead('codex', deadlineMs, refresh),
    ])
    // Each guest answer was checked against its own provider's shapes.
    return { claude: claude as ClaudeBridgeStatus, codex: codex as CodexBridgeStatus }
  }

  const transports = new Set<Socket>()
  // Closing the bridge ends every wait for a peer, so a stopping worker isn't held by one.
  const closing = new AbortController()
  // Only `close` ends the bridge's life; `endProofWaits` leaves turns that haven't started alone.
  const lifetime = new AbortController()

  /**
   * Reads a connection's first bytes: TLS goes to the TLS server as it arrived, and a relay's
   * lane offer is kept until a turn or probe of its route needs a guest.
   */
  function sniff(socket: Socket) {
    let buffered = Buffer.alloc(0)

    const refuse = () => {
      done()
      socket.destroy()
    }

    const timer = setTimeout(refuse, OFFER_LINE_MS)

    const done = () => {
      clearTimeout(timer)
      socket.off('data', read)
    }

    const read = (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk])
      if (buffered[0] === TLS_HANDSHAKE) {
        done()
        socket.pause()
        socket.unshift(buffered)
        server.emit('connection', socket)
        return
      }
      const end = buffered.indexOf(0x0a)
      if (end < 0) {
        if (buffered.length > MAX_OFFER_BYTES) {
          refuse()
        }
        return
      }
      done()
      const route = offerRoute(buffered.subarray(0, end).toString('latin1'))
      // Nothing may follow the offer until the coordinator asks for its guest.
      if (!route || buffered.length > end + 1 || offers.size >= offers.limit) {
        socket.destroy()
        return
      }
      socket.on('data', refuseEarlyBytes)
      offers.add(route, socket)
    }

    const refuseEarlyBytes = () => socket.destroy()

    socket.on('data', read)
  }

  /** Asks the relay behind an offer to start its guest, whose TLS connection follows. */
  function startGuest(socket: Socket) {
    socket.removeAllListeners('data')
    socket.pause()
    socket.write(LANE_START)
    server.emit('connection', socket)
  }

  /**
   * Starts a guest for `route` when its waiters have no idle or starting connection; each
   * waiter's poll calls this, and the offers start no more than the waiters need.
   */
  function demand(route: GuestRoute) {
    if (lifetime.signal.aborted) {
      return
    }
    const offer = offers.next(routeKey(route))
    if (offer) {
      startGuest(offer)
    }
  }

  const front = createTcpServer((socket) => {
    transports.add(socket)
    socket.once('close', () => transports.delete(socket))
    socket.on('error', () => socket.destroy())
    sniff(socket)
  })
  front.maxConnections = MAX_TURN_PEERS + MAX_STATUS_PEERS + MAX_CATALOG_PEERS + MAX_LANE_OFFERS
  front.listen(port, '127.0.0.1')
  await once(front, 'listening')

  /** Whether an admitted turn connection serves `route`. */
  function servesRoute(socket: TLSSocket, route: GuestRoute) {
    return subscriptions.get(socket) === route.subscription && rich.has(socket) === route.toolWorker
  }

  /** An idle turn connection of the manifest's route; `probe` and `reap` ask for those proofs. */
  function idlePeer(manifest: Record<string, unknown>, probe = false, reap = false) {
    const route = guestRoute(manifest)
    return [...idle].find(
      ([socket]) =>
        (!probe || probePeers.has(socket)) &&
        (!reap || reapPeers.has(socket)) &&
        servesRoute(socket, route),
    )
  }

  /** Whether the route has an open turn connection or lane offer: its relay is running. */
  function routeConnected(route: GuestRoute) {
    return (
      offers.hasOffer(routeKey(route)) ||
      [...admittedTurns].some((socket) => servesRoute(socket, route))
    )
  }

  function socketRouteKey(socket: TLSSocket) {
    return routeKey({ subscription: subscriptions.get(socket), toolWorker: rich.has(socket) })
  }

  /** Connections admitted and offers made for the route so far, which only ever grow. */
  function admissionsOf(route: GuestRoute) {
    return (routeAdmissions.get(routeKey(route)) ?? 0) + offers.offersMade(routeKey(route))
  }

  /**
   * An idle connection of the manifest's route for a probe, starting a guest on one of its relay's
   * offers when there is none. `leave` ends the probe's claim on a starting guest.
   */
  function probeConnections(manifest: Record<string, unknown>, reap: boolean) {
    const route = guestRoute(manifest)
    const leave = offers.wait(routeKey(route))

    const available = () => {
      const peer = idlePeer(manifest, true, reap)
      if (!peer) {
        demand(route)
      }
      return peer
    }

    return { available, leave }
  }

  /**
   * Whether the guest confirms the worker of an earlier turn removed, for the exact command that
   * turn sent (as recorded on its slot). Only `worker_removed` confirms; anything else, an
   * unreadable command or no peer before `signal` ends, does not.
   */
  async function confirmReaped(commandText: string, signal: AbortSignal) {
    let command: unknown
    try {
      command = JSON.parse(commandText)
    } catch {
      return false
    }
    if (!isRecord(command) || !isRecord(command.manifest)) {
      return false
    }
    const probe = probeConnections(command.manifest, true)
    try {
      const proof = await probeTerminal(
        probe.available,
        idle,
        command,
        AbortSignal.any([signal, closing.signal]),
        true,
      )
      return proof === 'worker_removed'
    } finally {
      probe.leave()
    }
  }

  /**
   * Waits for an idle connection of the turn's route until `deadline`, asking its relay for a
   * guest meanwhile. Throws the requeue or the absent-relay failure when none comes.
   */
  async function turnConnection(
    route: GuestRoute,
    manifest: Record<string, unknown>,
    deadline: number,
    signal: AbortSignal,
  ) {
    const leave = offers.wait(routeKey(route))
    const waiting = AbortSignal.any([signal, lifetime.signal])
    try {
      const admittedBefore = admissionsOf(route)
      // A busy connection or an offer of the route at any point shows its relay is running.
      let relaySeen = routeConnected(route)
      for (;;) {
        const connection = idlePeer(manifest)
        if (connection) {
          idle.delete(connection[0])
          return connection
        }
        if (Date.now() >= deadline) {
          // So does one admitted or offered during the wait, even if it closed between samples.
          relaySeen ||= admissionsOf(route) !== admittedBefore
          throw noConnection(route, relaySeen)
        }
        demand(route)
        await delay(100, undefined, { signal: waiting }).catch((error: unknown) => {
          // Closed with nothing sent: the turn goes back to the queue, as a cancellation doesn't.
          if (!signal.aborted) {
            throw new SessionCapacityUnavailable()
          }
          throw error
        })
        relaySeen ||= routeConnected(route)
      }
    } finally {
      leave()
    }
  }

  const driver: SessionDriver = async (turn, context) => {
    const route = guestRoute(context.manifest)
    const toolWorker = route.toolWorker
    if (toolWorker && !options) {
      throw new Error('protected_hosts_required')
    }
    const recordChild = context.recordChild
    if (!recordChild) {
      throw new Error('turn_child_recorder_required')
    }
    // One turn at a time starts on the VM, from its guest's start to its provider's admission.
    const started = await enterStartup(context.signal)
    try {
      return await runTurn(turn, { ...context, recordChild }, route, started)
    } finally {
      started()
    }
  }

  /**
   * The turn's place at the startup gate. A turn still waiting when the bridge closes, or that
   * waits past the bound, sent nothing and goes back to the queue; a cancelled one rejects.
   */
  async function enterStartup(signal: AbortSignal) {
    const waiting = AbortSignal.any([signal, lifetime.signal])
    const started = await startupGate
      .enter(waiting, turnTiming.startupWaitMs)
      .catch((error: unknown) => {
        if (signal.aborted) {
          throw error
        }
        return undefined
      })
    if (!started) {
      throw new SessionCapacityUnavailable()
    }
    return started
  }

  /** One turn on a connection of its route; `admitted` ends its hold on the startup gate. */
  async function runTurn(
    turn: SessionTurn,
    context: SessionDriverContext & { recordChild: (child: TurnChild) => Promise<void> },
    route: GuestRoute,
    admitted: () => void,
  ) {
    const toolWorker = route.toolWorker
    const waitMs = toolWorker ? turnTiming.toolWorkerPeerWaitMs : turnTiming.peerWaitMs
    const deadline = Date.now() + waitMs
    const [socket, frames] = await turnConnection(route, context.manifest, deadline, context.signal)
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
      // Committed before the guest can start anything, so a restart can ask about this command.
      await context.recordChild({ kind: 'vm', command: JSON.stringify(command) })
      // A cancellation during the write already closed the connection: nothing was sent.
      context.signal.throwIfAborted()
      if (socket.destroyed) {
        throw new Error('paired_guest_unavailable')
      }
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
          admitted()
          await turn.onStarted({ providerSessionId, actualModel })
          await frames.send({ ok: true })
          continue
        }
        if ('sentEffort' in msg) {
          // The guest may report only the effort this turn's input sealed.
          const sealed = context.manifest.agent?.effort
          if (sealed === undefined || msg.sentEffort !== sealed) {
            throw new Error('invalid_sent_effort')
          }
          admitted()
          await turn.onEffortSent(sealed)
          await frames.send({ ok: true })
          continue
        }
        if ('releaseId' in msg) {
          if (!toolWorker || !options?.confirmEvidence) {
            throw new Error('unexpected_evidence_release')
          }
          releases.confirm(msg.releaseId, (release) =>
            options.confirmEvidence!(
              context.identity.lineage,
              release.version,
              release.page === undefined
                ? undefined
                : { attemptId: context.identity.attemptId, page: release.page },
            ),
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
          // Only a fetched image can become citable; a preview's images get no release.
          const evidence = evidenceRequest(msg.mcp)
          const fetchRequest = evidence?.kind === 'fetch' ? evidence : undefined
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
          admitted()
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
          admitted()
          const probe = probeConnections(context.manifest, true)
          const proof = await probeTerminal(
            probe.available,
            idle,
            command,
            AbortSignal.any([AbortSignal.timeout(45_000), closing.signal]),
            true,
          ).finally(probe.leave)
          if (proof === 'worker_removed') {
            throw new NativeSessionError('agent_process_failed')
          }
        } else if (!cancelled && probePeers.has(socket)) {
          // The replacement relay only reads the exact turn journal. A missing or partial
          // record leaves the original interruption path in control.
          admitted()
          const probe = probeConnections(context.manifest, false)
          const outcome = await probeTerminal(
            probe.available,
            idle,
            command,
            AbortSignal.any([context.signal, closing.signal]),
          ).finally(probe.leave)
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
    confirmReaped,
    /** Ends every wait for a removal proof, leaving connections open; `close` does this too. */
    endProofWaits() {
      closing.abort()
    },
    providerStatus,
    modelCatalog,
    /** How many VM turns the agent VM holds, from the latest guest's memory report. */
    turnCapacity() {
      return vmTurnCapacity(vmMemory)
    },
    close() {
      lifetime.abort()
      closing.abort()
      for (const socket of transports) {
        socket.destroy()
      }
      front.close()
    },
  }
}

/** The guest's answer to a catalogue request of `kind`, or undefined for any other shape. */
function catalogAnswer(frame: Record<string, unknown>, kind: 'read' | 'generation') {
  let answer: BridgeCatalogAnswer
  try {
    answer = guestCatalogAnswer(frame)
  } catch {
    return undefined
  }
  if (answer.kind !== 'failure' && answer.kind !== kind) {
    return undefined
  }
  return answer
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Why a turn got no connection: its route's connections were all busy, so it waits in the queue,
 * or none was open, so its relay isn't running.
 */
function noConnection(route: GuestRoute, relaySeen: boolean) {
  if (relaySeen) {
    return new SessionCapacityUnavailable()
  }
  if (route.toolWorker) {
    return new NativeSessionError('agent_vm_unavailable')
  }
  if (route.subscription) {
    return new NativeSessionError('agent_login_required')
  }
  return new Error('paired_guest_unavailable')
}

type GuestRoute = ReturnType<typeof guestRoute>

function routeKey(route: { subscription: unknown; toolWorker: boolean }) {
  return `${String(route.subscription ?? 'none')}:${route.toolWorker ? 'tools' : 'plain'}`
}

/** The guest route a manifest needs: a tool worker for `/3`, and its subscription relay if any. */
function guestRoute(manifest: { profile_id?: unknown; agent?: unknown }) {
  const profile = manifest.profile_id
  const agent = isRecord(manifest.agent) ? manifest.agent : undefined
  const vmProfile = profile === 'shared-vm-agent/1' || profile === 'shared-vm-agent/3'
  const subscription =
    vmProfile && agent?.authentication === 'subscription' ? agent.provider : undefined
  return { toolWorker: profile === 'shared-vm-agent/3', subscription }
}

/** `receivedAt` dates a guest's answer; Codex's comes from a check `age_ms` before it. */
function bridgeStatus(
  status: GuestProviderStatus,
  receivedAt: number,
): ClaudeBridgeStatus | CodexBridgeStatus {
  const received = new Date(receivedAt).toISOString()
  switch (status.state) {
    case 'busy':
    case 'timeout':
    case 'checking':
      return { state: 'unknown', reason: status.state }
    case 'unavailable':
      return { state: 'unknown', reason: 'service_unavailable' }
    case 'saved':
      return {
        state: status.state,
        revision: status.revision,
        saved_at: status.saved_at,
        checked_at: received,
      }
    case 'not_saved':
      return { state: status.state, revision: status.revision, checked_at: received }
    case 'signed_in':
    case 'signed_out':
    case 'signing_in':
      return {
        state: status.state,
        checked_at: new Date(receivedAt - status.age_ms).toISOString(),
        refreshing: status.refreshing,
      }
  }
}

async function probeTerminal(
  available: (probe: boolean) => [TLSSocket, Frames] | undefined,
  idle: Map<TLSSocket, Frames>,
  command: Record<string, unknown>,
  signal: AbortSignal,
  requireReap = false,
) {
  const deadline = requireReap
    ? signal
    : AbortSignal.any([signal, AbortSignal.timeout(JOURNAL_PROBE_MS)])
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
