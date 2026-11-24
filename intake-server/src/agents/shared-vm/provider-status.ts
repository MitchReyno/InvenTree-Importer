// The status-only endpoint of a guest credential process, and the protocol the coordinator reads
// it with. It offers one read and no action, and needs no management key.
import { mkdir, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { once } from 'node:events'
import { createServer, type Server, type Socket } from 'node:net'
import { connect, type ConnectionOptions } from 'node:tls'
import { Frames } from './frames.ts'
import { settled } from '#/events/settled.ts'

export const STATUS_PROTOCOL = 'bench-provider-status/1'
/** In the credential container's private `/tmp`; reached only through `docker exec`. */
export const STATUS_SOCKET = '/tmp/bench-status/status.sock'
/** The guest's own bound on one read, cleanup included; the coordinator gives up a little later. */
export const GUEST_STATUS_DEADLINE_MS = 1500
/** Part of a read's time kept for an abandoned read to stop and reap its process. */
const STATUS_CLEANUP_MS = 500
/** Status frames are tiny; anything larger is refused before it is read. */
export const STATUS_FRAME_LIMIT = 4096
const MAX_STATUS_CONNECTIONS = 4

export type StatusProvider = 'claude' | 'codex'

/** A guest's answer. The revision stays between the guest and the server. */
export type GuestProviderStatus =
  | { provider: 'claude'; state: 'saved'; revision: string; saved_at: string | null }
  | { provider: 'claude'; state: 'not_saved'; revision: string }
  | { provider: 'codex'; state: 'signed_in' | 'signed_out' | 'signing_in' }
  | { provider: StatusProvider; state: 'busy' | 'timeout' | 'unavailable' }

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const isoTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

function hasExactly(value: Record<string, unknown>, keys: string[]) {
  const present = Object.keys(value).sort()
  return present.length === keys.length && [...keys].sort().every((key, i) => present[i] === key)
}

/** Accepts only the listed shapes for `provider`, so nothing else a guest sends is passed on. */
export function guestProviderStatus(provider: StatusProvider, value: unknown): GuestProviderStatus {
  const refuse = () => {
    throw new Error('invalid_provider_status')
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return refuse()
  }
  const answer = value as Record<string, unknown>
  if (answer.provider !== provider) {
    return refuse()
  }
  const state = answer.state
  if (state === 'busy' || state === 'timeout' || state === 'unavailable') {
    return hasExactly(answer, ['provider', 'state']) ? { provider, state } : refuse()
  }
  if (provider === 'codex') {
    const signIn = state === 'signed_in' || state === 'signed_out' || state === 'signing_in'
    return signIn && hasExactly(answer, ['provider', 'state']) ? { provider, state } : refuse()
  }
  const revision = typeof answer.revision === 'string' && uuid.test(answer.revision)
  if (state === 'not_saved' && revision && hasExactly(answer, ['provider', 'state', 'revision'])) {
    return { provider, state, revision: answer.revision as string }
  }
  const savedAt =
    answer.saved_at === null ||
    (typeof answer.saved_at === 'string' && isoTime.test(answer.saved_at))
  if (
    state === 'saved' &&
    revision &&
    savedAt &&
    hasExactly(answer, ['provider', 'state', 'revision', 'saved_at'])
  ) {
    return {
      provider,
      state,
      revision: answer.revision as string,
      saved_at: answer.saved_at as string | null,
    }
  }
  return refuse()
}

export interface StatusServiceOptions {
  provider: StatusProvider
  /** The guest pairing identity: the coordinator is the TLS server on this connection. */
  pairing: ConnectionOptions
  socketPath: string
  /** Reads the status; it must stop its work when `signal` aborts. */
  read: (signal: AbortSignal) => Promise<GuestProviderStatus>
  deadlineMs?: number
}

/**
 * Listens on a private Unix socket. Each connection is TLS to the paired coordinator, which asks
 * for one status at a time; a read is abandoned when its deadline passes or the connection closes.
 */
export async function serveProviderStatus(options: StatusServiceOptions): Promise<Server> {
  const { provider, socketPath } = options
  const deadlineMs = options.deadlineMs ?? GUEST_STATUS_DEADLINE_MS
  await mkdir(dirname(socketPath), { recursive: true, mode: 0o700 })
  await rm(socketPath, { force: true })
  const server = createServer(
    settled(
      async (connection: Socket) => {
        connection.on('error', () => connection.destroy())
        const socket = connect({
          ...options.pairing,
          socket: connection,
          servername: 'bench-coordinator',
        })
        const closed = new AbortController()
        socket.once('close', () => {
          closed.abort()
          connection.destroy()
        })
        await once(socket, 'secureConnect')
        socket.on('error', () => socket.destroy())
        const frames = new Frames(socket)
        await frames.send({ ready: STATUS_PROTOCOL, provider })
        for (;;) {
          const request = await frames.read(STATUS_FRAME_LIMIT)
          const withinMs = request.within_ms
          if (
            request.status !== true ||
            !hasExactly(request, ['status', 'within_ms']) ||
            !Number.isSafeInteger(withinMs) ||
            (withinMs as number) < 0
          ) {
            throw new Error('invalid_status_request')
          }
          const { status, cleanedUp } = await readWithin(
            options,
            Math.min(deadlineMs, withinMs as number),
            closed.signal,
          )
          await frames.send({ provider_status: status }, STATUS_FRAME_LIMIT)
          if (!cleanedUp) {
            // Its abandoned work is still stopping, so this connection takes no further read.
            throw new Error('status_cleanup_unconfirmed')
          }
        }
      },
      // A refused peer, a closed connection or a bad request ends that connection only.
      (_error, connection) => connection.destroy(),
    ),
  )
  server.maxConnections = MAX_STATUS_CONNECTIONS
  server.listen(socketPath)
  await once(server, 'listening')
  return server
}

/**
 * Answers `timeout` once the abandoned read has finished its cleanup, such as reaping the Codex
 * account process, or when that cleanup runs out of time, with `cleanedUp` false.
 */
async function readWithin(
  options: StatusServiceOptions,
  withinMs: number,
  closed: AbortSignal,
): Promise<{ status: GuestProviderStatus; cleanedUp: boolean }> {
  const cleanupMs = Math.min(STATUS_CLEANUP_MS, Math.floor(withinMs / 2))
  const deadline = AbortSignal.timeout(Math.max(0, withinMs - cleanupMs))
  const signal = AbortSignal.any([closed, deadline])
  const reading = options.read(signal).then(
    (status) => ({ status }),
    () => ({ status: undefined }),
  )
  const abandoned = new Promise<undefined>((resolve) => {
    signal.addEventListener('abort', () => resolve(undefined), { once: true })
  })
  const first = await Promise.race([reading, abandoned])
  if (first?.status) {
    return { status: first.status, cleanedUp: true }
  }
  closed.throwIfAborted()
  if (first && !deadline.aborted) {
    return { status: { provider: options.provider, state: 'unavailable' }, cleanedUp: true }
  }
  // Let the abandoned read release what it holds before saying it timed out.
  const cleanedUp = await Promise.race([reading.then(() => true), delayed(cleanupMs, false)])
  return { status: { provider: options.provider, state: 'timeout' }, cleanedUp }
}

function delayed<T>(ms: number, value: T) {
  return new Promise<T>((resolve) => {
    setTimeout(() => resolve(value), ms).unref()
  })
}
