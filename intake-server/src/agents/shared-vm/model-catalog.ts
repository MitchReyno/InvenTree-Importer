// The model catalogue endpoint of a guest credential process, and the protocol the coordinator
// reads it with. It reads the provider's models without a turn and changes no sign-in. It has a
// connection of its own beside the status endpoint, because a read may take seconds.
import { mkdir, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { once } from 'node:events'
import { createServer, type Server, type Socket } from 'node:net'
import { connect, type ConnectionOptions } from 'node:tls'
import { CATALOG_FAILURES, type AgentCatalogFailure } from '@invimport/contracts'
import { settled } from '#/events/settled.ts'
import { ResearchReapPendingError } from '#/research/errors.ts'
import { CatalogReadError } from '#/agents/model-catalog/normalise.ts'
import { Frames } from './frames.ts'
import type { StatusProvider } from './provider-status.ts'

export const CATALOG_PROTOCOL = 'bench-model-catalog/1'
/** Beside the status socket, in the credential container's private `/tmp`. */
export const CATALOG_SOCKET = '/tmp/bench-status/catalog.sock'
/** The coordinator's whole budget for one read. */
export const CATALOG_READ_MS = 20_000
/** A catalogue frame: a provider's raw list fits several times over. */
export const CATALOG_FRAME_BYTES = 64 * 1024
/**
 * Part of a read's time kept for an abandoned reader to stop: SIGKILL follows SIGTERM after
 * 250 ms, and its process group is confirmed gone within 2 s.
 */
export const CATALOG_CLEANUP_MS = 2_500
/** A generation-only answer reads one small file or row. */
export const CATALOG_GENERATION_MS = 2_000
const MAX_CATALOG_CONNECTIONS = 2
/** A sign-in generation: an opaque, non-secret identifier such as a UUID. */
const GENERATION = /^[A-Za-z0-9-]{1,64}$/

/** What a guest reader answered: the sign-in generation it read under, and the raw list. */
export interface GuestCatalogRead {
  generation: string
  cliVersion: string | null
  raw: unknown
}

export interface GuestCatalogReader {
  /** Must stop its process and reap it when `signal` aborts; throws `CatalogReadError`. */
  read(signal: AbortSignal): Promise<GuestCatalogRead>
  /** The current sign-in generation, starting no CLI. */
  generation(): Promise<string>
}

export type GuestCatalogAnswer =
  | { kind: 'read'; read: GuestCatalogRead }
  | { kind: 'generation'; generation: string }
  | { kind: 'failure'; failure: AgentCatalogFailure }

function hasExactly(value: Record<string, unknown>, keys: string[]) {
  const present = Object.keys(value).sort()
  return present.length === keys.length && [...keys].sort().every((key, i) => present[i] === key)
}

function isFailure(value: unknown): value is AgentCatalogFailure {
  return CATALOG_FAILURES.includes(value as AgentCatalogFailure)
}

/** The coordinator's view of a guest answer; anything outside these shapes is refused. */
export function guestCatalogAnswer(value: Record<string, unknown>): GuestCatalogAnswer {
  if (hasExactly(value, ['model_catalog_failure']) && isFailure(value.model_catalog_failure)) {
    return { kind: 'failure', failure: value.model_catalog_failure }
  }
  if (hasExactly(value, ['model_catalog_generation'])) {
    const generation = value.model_catalog_generation
    if (typeof generation === 'string' && GENERATION.test(generation)) {
      return { kind: 'generation', generation }
    }
  }
  if (hasExactly(value, ['model_catalog'])) {
    const read = value.model_catalog
    if (read && typeof read === 'object' && !Array.isArray(read)) {
      const answer = read as Record<string, unknown>
      const generation = answer.generation
      const version = answer.cli_version
      if (
        hasExactly(answer, ['generation', 'cli_version', 'raw']) &&
        typeof generation === 'string' &&
        GENERATION.test(generation) &&
        (version === null || (typeof version === 'string' && version.length <= 16))
      ) {
        return {
          kind: 'read',
          read: { generation, cliVersion: version as string | null, raw: answer.raw },
        }
      }
    }
  }
  throw new Error('invalid_model_catalog')
}

type CatalogRequest = { kind: 'read'; withinMs: number } | { kind: 'generation' }

function catalogRequest(request: Record<string, unknown>): CatalogRequest {
  if (hasExactly(request, ['catalog']) && request.catalog === 'generation') {
    return { kind: 'generation' }
  }
  const withinMs = request.within_ms
  if (
    hasExactly(request, ['catalog', 'within_ms']) &&
    request.catalog === 'read' &&
    typeof withinMs === 'number' &&
    Number.isSafeInteger(withinMs) &&
    withinMs >= 0
  ) {
    return { kind: 'read', withinMs: Math.min(withinMs, CATALOG_READ_MS) }
  }
  throw new Error('invalid_catalog_request')
}

export interface CatalogServiceOptions {
  provider: StatusProvider
  /** The guest pairing identity: the coordinator is the TLS server on this connection. */
  pairing: ConnectionOptions
  socketPath: string
  reader: GuestCatalogReader
}

/**
 * Listens on a private Unix socket. Each connection is TLS to the paired coordinator, which asks
 * for one read at a time; a read is abandoned when its time runs out or the connection closes.
 */
export async function serveModelCatalog(options: CatalogServiceOptions): Promise<Server> {
  const { provider, socketPath } = options
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
        await frames.send({ ready: CATALOG_PROTOCOL, provider })
        for (;;) {
          const request = catalogRequest(await frames.read(CATALOG_FRAME_BYTES))
          const answer = await answerRequest(options.reader, request, closed.signal)
          await sendAnswer(frames, answer)
        }
      },
      // A refused peer, a closed connection, a bad request or an unreaped reader ends this
      // connection only.
      (_error, connection) => connection.destroy(),
    ),
  )
  server.maxConnections = MAX_CATALOG_CONNECTIONS
  server.listen(socketPath)
  await once(server, 'listening')
  return server
}

/** An answer too large for the frame is sent as `malformed`, never cut. */
async function sendAnswer(frames: Frames, answer: Record<string, unknown>) {
  const bytes = Buffer.byteLength(JSON.stringify(answer))
  if (bytes > CATALOG_FRAME_BYTES - 4) {
    await frames.send({ model_catalog_failure: 'malformed' }, CATALOG_FRAME_BYTES)
    return
  }
  await frames.send(answer, CATALOG_FRAME_BYTES)
}

async function answerRequest(
  reader: GuestCatalogReader,
  request: CatalogRequest,
  closed: AbortSignal,
): Promise<Record<string, unknown>> {
  if (request.kind === 'generation') {
    const generation = await withTimeout(reader.generation(), CATALOG_GENERATION_MS)
    if (generation === undefined || !GENERATION.test(generation)) {
      return { model_catalog_failure: 'unavailable' }
    }
    return { model_catalog_generation: generation }
  }
  const outcome = await readWithin(reader, request.withinMs, closed)
  if ('failure' in outcome) {
    return { model_catalog_failure: outcome.failure }
  }
  const { generation, cliVersion, raw } = outcome.read
  return { model_catalog: { generation, cli_version: cliVersion, raw } }
}

async function withTimeout<T>(work: Promise<T>, ms: number) {
  const timer = new AbortController()
  const late = new Promise<undefined>((resolve) => {
    setTimeout(() => resolve(undefined), ms).unref()
    timer.signal.addEventListener('abort', () => resolve(undefined))
  })
  try {
    return await Promise.race([work.catch(() => undefined), late])
  } finally {
    timer.abort()
  }
}

type ReadOutcome = { read: GuestCatalogRead } | { failure: AgentCatalogFailure }

/**
 * Answers `timeout` only once the abandoned reader is confirmed reaped; a budget with no room for
 * that starts no read. An unconfirmed reap throws, which closes the connection unanswered.
 */
async function readWithin(
  reader: GuestCatalogReader,
  withinMs: number,
  closed: AbortSignal,
): Promise<ReadOutcome> {
  if (withinMs <= CATALOG_CLEANUP_MS) {
    return { failure: 'timeout' }
  }
  const deadline = AbortSignal.timeout(withinMs - CATALOG_CLEANUP_MS)
  const signal = AbortSignal.any([closed, deadline])
  try {
    return { read: await reader.read(signal) }
  } catch (error) {
    if (error instanceof ResearchReapPendingError) {
      throw new Error('catalog_reap_unconfirmed', { cause: error })
    }
    closed.throwIfAborted()
    if (deadline.aborted) {
      return { failure: 'timeout' }
    }
    if (error instanceof CatalogReadError) {
      return { failure: error.code }
    }
    return { failure: 'unavailable' }
  }
}
