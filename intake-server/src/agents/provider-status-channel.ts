// The API asks the session worker for provider status over PostgreSQL notifications: the two
// processes already share the database and the Processing channel secret, and nothing else.
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import type { Notification, Pool, PoolClient } from 'pg'
import { setTimeout as delay } from 'node:timers/promises'
import type { ProcessingConfig } from '#/processing/attempts.ts'
import type {
  BridgeProviderStatuses,
  BridgeStatusUnknownReason,
  ClaudeBridgeStatus,
  CodexBridgeStatus,
} from './shared-vm/coordinator.ts'

export const STATUS_REQUEST_CHANNEL = 'bench_provider_status_request'
export const STATUS_REPLY_CHANNEL = 'bench_provider_status_reply'
/** The API's whole wait for the worker, from the design. */
export const STATUS_REQUEST_TIMEOUT_MS = 2000
/** A request older than this is stale: the API that sent it has stopped waiting. */
const REQUEST_MAX_AGE_MS = STATUS_REQUEST_TIMEOUT_MS
const WORKER_RELISTEN_MS = 1000

type Binding = Pick<ProcessingConfig, 'actorId' | 'targetId' | 'targetContextId' | 'channelSecret'>

interface StatusRequest {
  id: string
  actor_id: string
  target_id: string
  target_context_id: string
  sent_at: number
}

interface StatusReply {
  id: string
  status: BridgeProviderStatuses
}

function channelKey(binding: Binding) {
  return createHmac('sha256', binding.channelSecret).update('bench-provider-status/1').digest()
}

/** `<mac>.<body>`: the MAC binds the message kind, so a request can't pass as a reply. */
function sign(binding: Binding, kind: 'request' | 'reply', body: unknown) {
  const text = JSON.stringify(body)
  const mac = createHmac('sha256', channelKey(binding))
    .update(kind + '\n' + text)
    .digest('hex')
  return mac + '.' + text
}

/** The signed body, or undefined for anything another sender or another scope produced. */
function opened(binding: Binding, kind: 'request' | 'reply', payload: string | undefined) {
  const separator = payload?.indexOf('.') ?? -1
  if (!payload || separator !== 64) {
    return undefined
  }
  const text = payload.slice(separator + 1)
  const expected = createHmac('sha256', channelKey(binding))
    .update(kind + '\n' + text)
    .digest()
  const given = Buffer.from(payload.slice(0, separator), 'hex')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return undefined
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

function inScope(binding: Binding, value: unknown): value is StatusRequest {
  if (!value || typeof value !== 'object') {
    return false
  }
  const request = value as Record<string, unknown>
  return (
    typeof request.id === 'string' &&
    request.actor_id === binding.actorId &&
    request.target_id === binding.targetId &&
    request.target_context_id === binding.targetContextId &&
    typeof request.sent_at === 'number' &&
    Math.abs(Date.now() - request.sent_at) <= REQUEST_MAX_AGE_MS
  )
}

const UNKNOWN_REASONS = new Set<BridgeStatusUnknownReason>([
  'not_configured',
  'vm_unreachable',
  'service_unavailable',
  'guest_outdated',
  'busy',
  'timeout',
])

function unknownStatus(value: Record<string, unknown>) {
  const reason = value.reason as BridgeStatusUnknownReason
  if (value.state === 'unknown' && UNKNOWN_REASONS.has(reason) && Object.keys(value).length === 2) {
    return { state: 'unknown' as const, reason }
  }
  return undefined
}

function claudeStatus(value: Record<string, unknown>): ClaudeBridgeStatus | undefined {
  if (value.state === 'saved' && typeof value.revision === 'string') {
    const savedAt = value.saved_at === null || typeof value.saved_at === 'string'
    return savedAt && Object.keys(value).length === 3
      ? { state: 'saved', revision: value.revision, saved_at: value.saved_at as string | null }
      : undefined
  }
  if (value.state === 'not_saved' && typeof value.revision === 'string') {
    return Object.keys(value).length === 2
      ? { state: 'not_saved', revision: value.revision }
      : undefined
  }
  return unknownStatus(value)
}

function codexStatus(value: Record<string, unknown>): CodexBridgeStatus | undefined {
  const state = value.state
  if (state === 'signed_in' || state === 'signed_out' || state === 'signing_in') {
    return Object.keys(value).length === 1 ? { state } : undefined
  }
  return unknownStatus(value)
}

const record = (value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined

/** The worker's statuses, checked again here, or undefined. */
function replyStatus(value: unknown, id: string): BridgeProviderStatuses | undefined {
  const reply = record(value)
  const status = record(reply?.status)
  const claude = record(status?.claude)
  const codex = record(status?.codex)
  if (reply?.id !== id || !claude || !codex) {
    return undefined
  }
  const statuses = { claude: claudeStatus(claude), codex: codexStatus(codex) }
  if (!statuses.claude || !statuses.codex) {
    return undefined
  }
  return { claude: statuses.claude, codex: statuses.codex }
}

/**
 * Asks the worker and waits at most `timeoutMs`, connection included. Undefined means the worker
 * didn't answer in time, or isn't running.
 */
export async function requestProviderStatus(
  pool: Pool,
  binding: Binding,
  timeoutMs = STATUS_REQUEST_TIMEOUT_MS,
): Promise<BridgeProviderStatuses | undefined> {
  // A held timer, unlike `AbortSignal.timeout`'s, so a caller with nothing else pending still waits.
  const expiry = new AbortController()
  const timer = setTimeout(() => expiry.abort(), timeoutMs)
  try {
    return await exchange(pool, binding, expiry.signal)
  } finally {
    clearTimeout(timer)
  }
}

async function exchange(
  pool: Pool,
  binding: Binding,
  deadline: AbortSignal,
): Promise<BridgeProviderStatuses | undefined> {
  const connecting = pool.connect()
  const client = await Promise.race([connecting, abortedAt(deadline)])
  if (!client) {
    // A connection that arrives after the deadline goes straight back.
    void connecting.then((late) => late.release()).catch(() => {})
    return undefined
  }
  const id = randomUUID()
  let answer!: (status: BridgeProviderStatuses) => void
  const answered = new Promise<BridgeProviderStatuses>((resolve) => (answer = resolve))

  const receive = (message: Notification) => {
    if (message.channel !== STATUS_REPLY_CHANNEL) {
      return
    }
    const status = replyStatus(opened(binding, 'reply', message.payload), id)
    if (status) {
      answer(status)
    }
  }

  client.on('notification', receive)
  let healthy = true
  try {
    await client.query(`LISTEN ${STATUS_REPLY_CHANNEL}`)
    const request: StatusRequest = {
      id,
      actor_id: binding.actorId,
      target_id: binding.targetId,
      target_context_id: binding.targetContextId,
      sent_at: Date.now(),
    }
    await client.query('SELECT pg_notify($1, $2)', [
      STATUS_REQUEST_CHANNEL,
      sign(binding, 'request', request),
    ])
    return await Promise.race([answered, abortedAt(deadline)])
  } catch {
    healthy = false
    return undefined
  } finally {
    client.off('notification', receive)
    await client.query(`UNLISTEN ${STATUS_REPLY_CHANNEL}`).catch(() => {
      healthy = false
    })
    // A connection whose state is uncertain is closed rather than reused.
    client.release(healthy ? undefined : true)
  }
}

/** Resolves undefined once `signal` aborts. */
function abortedAt(signal: AbortSignal) {
  return new Promise<undefined>((resolve) => {
    if (signal.aborted) {
      resolve(undefined)
    }
    signal.addEventListener('abort', () => resolve(undefined), { once: true })
  })
}

/**
 * Answers this scope's signed requests with `read`, on one dedicated connection that is opened
 * again if it fails. Requests arriving while a read runs share its answer.
 */
export function serveProviderStatusRequests(
  pool: Pool,
  binding: Binding,
  read: () => Promise<BridgeProviderStatuses>,
) {
  const stopping = new AbortController()
  let current: Promise<BridgeProviderStatuses> | undefined

  const shared = () => {
    current ??= read().finally(() => {
      current = undefined
    })
    return current
  }

  const answer = async (request: StatusRequest) => {
    const status = await shared()
    const reply: StatusReply = { id: request.id, status }
    await pool.query('SELECT pg_notify($1, $2)', [
      STATUS_REPLY_CHANNEL,
      sign(binding, 'reply', reply),
    ])
  }

  const receive = (message: Notification) => {
    if (message.channel !== STATUS_REQUEST_CHANNEL) {
      return
    }
    const request = opened(binding, 'request', message.payload)
    if (inScope(binding, request)) {
      // A reply that can't be sent leaves the API to report the worker unavailable.
      void answer(request).catch(() => {})
    }
  }

  const listening = (async () => {
    while (!stopping.signal.aborted) {
      let client: PoolClient | undefined
      try {
        client = await pool.connect()
        const lost = new Promise<void>((resolve) => client!.once('error', () => resolve()))
        client.on('notification', receive)
        await client.query(`LISTEN ${STATUS_REQUEST_CHANNEL}`)
        await Promise.race([lost, abortedAt(stopping.signal)])
      } catch {
        // Listen again below.
      } finally {
        client?.off('notification', receive)
        client?.release(true)
      }
      await delay(WORKER_RELISTEN_MS, undefined, { signal: stopping.signal }).catch(() => {})
    }
  })()

  return {
    async close() {
      stopping.abort()
      await listening
    },
  }
}
