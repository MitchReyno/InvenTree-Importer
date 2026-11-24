// The status-only endpoint of a guest credential process, and the protocol the coordinator reads
// it with. It offers one read and no action, and needs no management key.
import { mkdir, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { once } from 'node:events'
import { createServer, type Server, type Socket } from 'node:net'
import { connect, type ConnectionOptions } from 'node:tls'
import { Frames } from './frames.ts'
import { settled } from '#/events/settled.ts'
import { ResearchReapPendingError } from '#/research/errors.ts'

export const STATUS_PROTOCOL = 'bench-provider-status/1'
/** In the credential container's private `/tmp`; reached only through `docker exec`. */
export const STATUS_SOCKET = '/tmp/bench-status/status.sock'
/** The guest's own bound on one read, cleanup included; the coordinator gives up a little later. */
export const GUEST_STATUS_DEADLINE_MS = 1500
/**
 * Part of a read's time kept for an abandoned read to stop and reap its process: the account
 * process gets SIGKILL 250 ms after SIGTERM, then its group is checked gone.
 */
const STATUS_CLEANUP_MS = 500
/** The shortest read worth starting. */
const MIN_STATUS_READ_MS = 100
/** Status frames are tiny; anything larger is refused before it is read. */
export const STATUS_FRAME_LIMIT = 4096
const MAX_STATUS_CONNECTIONS = 4

export type StatusProvider = 'claude' | 'codex'

/**
 * A guest's answer. The revision stays between the guest and the server. Codex answers from its
 * last check, `age_ms` old, measured on the guest so its clock never has to match the server's;
 * an older guest sends no age, because it read the account for that request.
 */
export type GuestProviderStatus =
  | { provider: 'claude'; state: 'saved'; revision: string; saved_at: string | null }
  | { provider: 'claude'; state: 'not_saved'; revision: string }
  | { provider: 'codex'; state: 'signed_in' | 'signed_out' | 'signing_in'; age_ms: number }
  | { provider: 'codex'; state: 'checking' }
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
    return codexGuestStatus(answer) ?? refuse()
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

function codexGuestStatus(answer: Record<string, unknown>): GuestProviderStatus | undefined {
  const state = answer.state
  if (state === 'checking') {
    return hasExactly(answer, ['provider', 'state']) ? { provider: 'codex', state } : undefined
  }
  if (state !== 'signed_in' && state !== 'signed_out' && state !== 'signing_in') {
    return undefined
  }
  if (hasExactly(answer, ['provider', 'state'])) {
    return { provider: 'codex', state, age_ms: 0 }
  }
  const age = answer.age_ms
  const validAge = typeof age === 'number' && Number.isSafeInteger(age) && age >= 0
  if (validAge && hasExactly(answer, ['provider', 'state', 'age_ms'])) {
    return { provider: 'codex', state, age_ms: age }
  }
  return undefined
}

/** One status request: how long the guest may take, and whether Check again asked for it. */
export interface StatusRequest {
  withinMs: number
  refresh: boolean
}

function statusRequest(request: Record<string, unknown>): StatusRequest {
  const withinMs = request.within_ms
  const keys =
    request.refresh === true ? ['status', 'within_ms', 'refresh'] : ['status', 'within_ms']
  if (
    request.status !== true ||
    !hasExactly(request, keys) ||
    typeof withinMs !== 'number' ||
    !Number.isSafeInteger(withinMs) ||
    withinMs < 0
  ) {
    throw new Error('invalid_status_request')
  }
  return { withinMs, refresh: request.refresh === true }
}

/**
 * Reads the status; it must stop its work when `signal` aborts. `refresh` asks it to start a
 * fresh check where it answers from an earlier one.
 */
export type StatusReader = (signal: AbortSignal, refresh: boolean) => Promise<GuestProviderStatus>

export interface StatusServiceOptions {
  provider: StatusProvider
  /** The guest pairing identity: the coordinator is the TLS server on this connection. */
  pairing: ConnectionOptions
  socketPath: string
  read: StatusReader
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
          const request = statusRequest(await frames.read(STATUS_FRAME_LIMIT))
          const status = await readWithin(
            options,
            { ...request, withinMs: Math.min(deadlineMs, request.withinMs) },
            closed.signal,
          )
          await frames.send({ provider_status: status }, STATUS_FRAME_LIMIT)
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
 * Answers `timeout` only once the abandoned read has confirmed its cleanup, such as reaping the
 * Codex account process. A budget too short to leave room for that cleanup starts no read. When
 * cleanup isn't confirmed in time, it throws instead, which closes the connection unanswered.
 */
async function readWithin(
  options: StatusServiceOptions,
  request: StatusRequest,
  closed: AbortSignal,
): Promise<GuestProviderStatus> {
  const withinMs = request.withinMs
  if (withinMs < STATUS_CLEANUP_MS + MIN_STATUS_READ_MS) {
    return { provider: options.provider, state: 'timeout' }
  }
  const deadline = AbortSignal.timeout(withinMs - STATUS_CLEANUP_MS)
  const signal = AbortSignal.any([closed, deadline])
  const reading = options.read(signal, request.refresh).then(
    (status) => ({ status, reaped: true }),
    (error: unknown) => ({
      status: undefined,
      reaped: !(error instanceof ResearchReapPendingError),
    }),
  )
  const abandoned = new Promise<undefined>((resolve) => {
    signal.addEventListener('abort', () => resolve(undefined), { once: true })
  })
  const first = await Promise.race([reading, abandoned])
  if (first?.status) {
    return first.status
  }
  closed.throwIfAborted()
  if (first && first.reaped && !deadline.aborted) {
    return { provider: options.provider, state: 'unavailable' }
  }
  // Let the abandoned read release what it holds before saying it timed out.
  const settled = await Promise.race([reading, delayed(STATUS_CLEANUP_MS, undefined)])
  if (!settled?.reaped) {
    throw new Error('status_cleanup_unconfirmed')
  }
  return { provider: options.provider, state: 'timeout' }
}

function delayed<T>(ms: number, value: T) {
  return new Promise<T>((resolve) => {
    setTimeout(() => resolve(value), ms).unref()
  })
}
