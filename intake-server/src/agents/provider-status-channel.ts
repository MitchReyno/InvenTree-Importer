// The API asks the session worker for provider status over PostgreSQL notifications: the two
// processes already share the database and the Processing channel secret, and nothing else.
// Any role on the database can see these messages, so they carry only display states, and a MAC
// over each one keeps other roles from asking or answering.
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import type { Notification, Pool, PoolClient } from 'pg'
import { setTimeout as delay } from 'node:timers/promises'
import type { ProcessingConfig } from '#/processing/attempts.ts'
import type {
  BridgeProviderStatuses,
  BridgeStatusUnknownReason,
  CodexBridgeStatus,
} from './shared-vm/coordinator.ts'

export const STATUS_REQUEST_CHANNEL = 'bench_provider_status_request'
export const STATUS_REPLY_CHANNEL = 'bench_provider_status_reply'
/** The API's whole wait for the worker, from the design. */
export const STATUS_REQUEST_TIMEOUT_MS = 2000
const WORKER_RELISTEN_MS = 1000
/** How long the API waits for `UNLISTEN` before closing the connection instead. */
const CLEANUP_MS = 250
/** Live requests the worker accepts at once; more are left unanswered. */
const MAX_LIVE_REQUESTS = 64
/** Kept back from a request's budget for the reply to reach the API. */
const REPLY_MARGIN_MS = 150

type Binding = Pick<ProcessingConfig, 'actorId' | 'targetId' | 'targetContextId' | 'channelSecret'>

type UnknownStatus = { state: 'unknown'; reason: BridgeStatusUnknownReason }

/** What the worker tells the API: Claude's credential revision stays with the worker. */
export type ClaudeDisplayStatus =
  { state: 'saved'; saved_at: string | null } | { state: 'not_saved' } | UnknownStatus
export interface DisplayProviderStatuses {
  claude: ClaudeDisplayStatus
  codex: CodexBridgeStatus
}

interface StatusRequest {
  id: string
  actor_id: string
  target_id: string
  target_context_id: string
  /** When the API stops waiting, in epoch milliseconds; the worker doesn't answer after it. */
  expires_at: number
}

interface StatusReply {
  id: string
  status: DisplayProviderStatuses
}

function channelKey(binding: Binding) {
  return createHmac('sha256', binding.channelSecret).update('bench-provider-status/1').digest()
}

function mac(binding: Binding, kind: 'request' | 'reply', text: string) {
  return createHmac('sha256', channelKey(binding))
    .update(kind + '\n' + text)
    .digest()
}

/** `<mac>.<body>`: the MAC binds the message kind, so a request can't pass as a reply. */
function sign(binding: Binding, kind: 'request' | 'reply', body: StatusRequest | StatusReply) {
  const text = JSON.stringify(body)
  return mac(binding, kind, text).toString('hex') + '.' + text
}

/** The signed body, or undefined for anything another sender or another scope produced. */
function opened(binding: Binding, kind: 'request' | 'reply', payload: string | undefined) {
  const separator = payload?.indexOf('.') ?? -1
  if (!payload || separator !== 64) {
    return undefined
  }
  const text = payload.slice(separator + 1)
  const given = Buffer.from(payload.slice(0, separator), 'hex')
  const expected = mac(binding, kind, text)
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return undefined
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

const record = (value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined

function liveRequest(binding: Binding, value: unknown): StatusRequest | undefined {
  const request = record(value)
  if (
    !request ||
    typeof request.id !== 'string' ||
    request.actor_id !== binding.actorId ||
    request.target_id !== binding.targetId ||
    request.target_context_id !== binding.targetContextId ||
    typeof request.expires_at !== 'number' ||
    request.expires_at > Date.now() + STATUS_REQUEST_TIMEOUT_MS ||
    request.expires_at <= Date.now()
  ) {
    return undefined
  }
  return request as unknown as StatusRequest
}

const UNKNOWN_REASONS = new Set<BridgeStatusUnknownReason>([
  'not_configured',
  'vm_unreachable',
  'service_unavailable',
  'guest_outdated',
  'busy',
  'timeout',
])

function unknownStatus(value: Record<string, unknown>): UnknownStatus | undefined {
  const reason = value.reason as BridgeStatusUnknownReason
  if (value.state === 'unknown' && UNKNOWN_REASONS.has(reason) && Object.keys(value).length === 2) {
    return { state: 'unknown', reason }
  }
  return undefined
}

function claudeStatus(value: Record<string, unknown>): ClaudeDisplayStatus | undefined {
  if (value.state === 'saved') {
    const savedAt = value.saved_at === null || typeof value.saved_at === 'string'
    return savedAt && Object.keys(value).length === 2
      ? { state: 'saved', saved_at: value.saved_at as string | null }
      : undefined
  }
  if (value.state === 'not_saved') {
    return Object.keys(value).length === 1 ? { state: 'not_saved' } : undefined
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

/** The worker's statuses for request `id`, checked again here, or undefined. */
function replyStatus(value: unknown, id: string): DisplayProviderStatuses | undefined {
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

/** The coordinator's statuses without Claude's credential revision. */
export function displayStatuses(statuses: BridgeProviderStatuses): DisplayProviderStatuses {
  const claude = statuses.claude
  switch (claude.state) {
    case 'saved':
      return { claude: { state: 'saved', saved_at: claude.saved_at }, codex: statuses.codex }
    case 'not_saved':
      return { claude: { state: 'not_saved' }, codex: statuses.codex }
    case 'unknown':
      return { claude, codex: statuses.codex }
  }
}

/** Whether `query` succeeds within `ms`. */
async function settlesWithin(query: Promise<unknown>, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), ms)
  })
  try {
    return await Promise.race([
      query.then(
        () => true,
        () => false,
      ),
      late,
    ])
  } finally {
    clearTimeout(timer)
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
 * Asks the worker and waits at most `timeoutMs`, from taking a connection to the reply. Undefined
 * means the worker didn't answer in time, or isn't running.
 */
export async function requestProviderStatus(
  pool: Pool,
  binding: Binding,
  timeoutMs = STATUS_REQUEST_TIMEOUT_MS,
): Promise<DisplayProviderStatuses | undefined> {
  // A held timer, unlike `AbortSignal.timeout`'s, so a caller with nothing else pending still waits.
  const expiry = new AbortController()
  const expiresAt = Date.now() + timeoutMs
  const timer = setTimeout(() => expiry.abort(), timeoutMs)
  try {
    return await exchange(pool, binding, expiry.signal, expiresAt)
  } finally {
    clearTimeout(timer)
  }
}

async function exchange(
  pool: Pool,
  binding: Binding,
  deadline: AbortSignal,
  expiresAt: number,
): Promise<DisplayProviderStatuses | undefined> {
  const connecting = pool.connect()
  // A refused connection is a worker that can't be asked, never a failed route.
  const client = await Promise.race([connecting, abortedAt(deadline)]).catch(() => undefined)
  if (!client) {
    // A connection that arrives after the deadline goes straight back.
    void connecting.then((late) => late.release()).catch(() => {})
    return undefined
  }
  const id = randomUUID()
  let healthy = true
  let answer!: (status: DisplayProviderStatuses | undefined) => void
  const answered = new Promise<DisplayProviderStatuses | undefined>((resolve) => {
    answer = resolve
  })

  const receive = (message: Notification) => {
    if (message.channel !== STATUS_REPLY_CHANNEL) {
      return
    }
    const status = replyStatus(opened(binding, 'reply', message.payload), id)
    if (status) {
      answer(status)
    }
  }

  // A checked-out client has no pool listener, so a lost connection must be caught here.
  const lost = () => {
    healthy = false
    answer(undefined)
  }

  client.on('notification', receive)
  client.on('error', lost)
  const ended = Promise.race([answered, abortedAt(deadline)])

  /** A query that outlives the deadline leaves the connection in an unknown state. */
  const within = async (query: Promise<unknown>) => {
    query.catch(() => {})
    const done = await Promise.race([query.then(() => true), ended.then(() => false)])
    if (!done) {
      healthy = false
    }
    return done
  }

  try {
    if (!(await within(client.query(`LISTEN ${STATUS_REPLY_CHANNEL}`)))) {
      return undefined
    }
    const request: StatusRequest = {
      id,
      actor_id: binding.actorId,
      target_id: binding.targetId,
      target_context_id: binding.targetContextId,
      expires_at: expiresAt,
    }
    const sending = client.query('SELECT pg_notify($1, $2)', [
      STATUS_REQUEST_CHANNEL,
      sign(binding, 'request', request),
    ])
    if (!(await within(sending))) {
      return undefined
    }
    return await ended
  } catch {
    healthy = false
    return undefined
  } finally {
    client.off('notification', receive)
    // Cleanup stays inside the same budget; past it the connection is closed instead.
    const left = expiresAt - Date.now()
    if (healthy && left > 0) {
      const cleanupMs = Math.min(CLEANUP_MS, left)
      healthy = await settlesWithin(client.query(`UNLISTEN ${STATUS_REPLY_CHANNEL}`), cleanupMs)
    } else {
      healthy = false
    }
    client.off('error', lost)
    // A connection whose state is uncertain is closed rather than reused.
    client.release(healthy ? undefined : true)
  }
}

/**
 * Answers this scope's signed requests with `read`, given what is left of the request's budget, on
 * one held connection that is opened again if it fails. Requests arriving while a read runs share
 * its answer; each request ID is answered at most once, and its reply isn't sent after its expiry.
 */
export function serveProviderStatusRequests(
  pool: Pool,
  binding: Binding,
  read: (budgetMs: number) => Promise<BridgeProviderStatuses>,
) {
  const stopping = new AbortController()
  // Each accepted request ID until it expires, so a replay within its life is refused.
  const live = new Map<string, number>()
  let current: Promise<BridgeProviderStatuses> | undefined

  const shared = (budgetMs: number) => {
    current ??= read(budgetMs).finally(() => {
      current = undefined
    })
    return current
  }

  /** Sends the reply only while its request is live, connection included. */
  const reply = async (request: StatusRequest, status: DisplayProviderStatuses) => {
    const connecting = pool.connect()
    const expiry = new AbortController()
    const timer = setTimeout(() => expiry.abort(), Math.max(0, request.expires_at - Date.now()))
    try {
      const client = await Promise.race([connecting, abortedAt(expiry.signal)])
      if (!client) {
        void connecting.then((late) => late.release()).catch(() => {})
        return
      }
      try {
        if (Date.now() < request.expires_at) {
          await client.query('SELECT pg_notify($1, $2)', [
            STATUS_REPLY_CHANNEL,
            sign(binding, 'reply', { id: request.id, status }),
          ])
        }
      } finally {
        client.release()
      }
    } finally {
      clearTimeout(timer)
    }
  }

  const answer = async (request: StatusRequest) => {
    const budgetMs = request.expires_at - Date.now() - REPLY_MARGIN_MS
    if (budgetMs <= 0) {
      return
    }
    const status = displayStatuses(await shared(budgetMs))
    await reply(request, status)
  }

  const admit = (request: StatusRequest) => {
    const now = Date.now()
    for (const [id, expiresAt] of live) {
      if (expiresAt <= now) {
        live.delete(id)
      }
    }
    if (live.has(request.id) || live.size >= MAX_LIVE_REQUESTS) {
      return false
    }
    live.set(request.id, request.expires_at)
    return true
  }

  const receive = (message: Notification) => {
    if (message.channel !== STATUS_REQUEST_CHANNEL) {
      return
    }
    const request = liveRequest(binding, opened(binding, 'request', message.payload))
    if (!request || !admit(request)) {
      return
    }
    // A reply that can't be sent leaves the API to report the worker unavailable.
    void answer(request).catch(() => {})
  }

  const listening = (async () => {
    while (!stopping.signal.aborted) {
      let client: PoolClient | undefined
      try {
        client = await pool.connect()
        let lose!: () => void
        const lost = new Promise<void>((resolve) => {
          lose = resolve
        })
        client.on('error', lose)
        client.on('notification', receive)
        await client.query(`LISTEN ${STATUS_REQUEST_CHANNEL}`)
        await Promise.race([lost, abortedAt(stopping.signal)])
      } catch {
        // Listen again below.
      } finally {
        client?.off('notification', receive)
        // The listener stays: the released, destroyed client may still report its error.
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
