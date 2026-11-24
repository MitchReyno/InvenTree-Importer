import { useSyncExternalStore } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { useServerScope } from '#/context'
import { serverQueryKey, type ServerScope } from '#/queries/scope'

/**
 * A chat message being sent, one whose send went unconfirmed, or one saved but not yet in a
 * history read. `after` is the newest inbox row the history showed when it was sent; a saved
 * send has its row's `seq` and `savedOrder`, its receipt's place in the history read order.
 */
export type PendingSend = {
  text: string
  key: string
  after: number
  status: 'sending' | 'unconfirmed' | 'saved'
  seq?: number
  savedOrder?: number
}

/** A history read's place in the order it shares with send receipts. */
export type HistoryReadOrder = { readOrder?: number }

/**
 * Sends outlive the composer for as long as the page is open. Each session's sends are kept by
 * delivery key, in the order sent, from before the request starts; an unconfirmed one until the
 * operator retries or discards it, and a saved one until every held history read covers it.
 */
const pendingSends = new Map<string, readonly PendingSend[]>()
/** Each store key's batch and job, so a held send can find that session's history reads. */
const sessions = new Map<string, { batchId: string; jobId: string }>()
/** The newest row each session's sends were saved as, kept after those sends retire. */
const floors = new Map<string, number>()
let order = 0
const listeners = new Set<() => void>()
const NONE: readonly PendingSend[] = []

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function publish(storeKey: string, sends: readonly PendingSend[]) {
  if (sends.length) {
    pendingSends.set(storeKey, sends)
  } else {
    pendingSends.delete(storeKey)
    sessions.delete(storeKey)
  }
  const savedSeqs = sends.flatMap((send) => (send.seq === undefined ? [] : [send.seq]))
  if (savedSeqs.length) {
    floors.set(storeKey, Math.max(floors.get(storeKey) ?? 0, ...savedSeqs))
  }
  listeners.forEach((listener) => listener())
}

/**
 * The next place in one order shared by history reads, taken as each read starts, and send
 * receipts, taken as each arrives. A read placed after a receipt started after the row was saved,
 * so it holds the row or a newest page that has moved past it.
 */
export function nextHistoryOrder() {
  order += 1
  return order
}

function scopeKey(scope: ServerScope) {
  return [scope.origin, scope.actorId, scope.targetId, scope.targetContextId].join('|')
}

/** One session's sends within one server scope, so another origin or account never sees them. */
export function pendingSendKey(scope: ServerScope, batchId: string, jobId: string) {
  return [scopeKey(scope), batchId, jobId].join('|')
}

/** Discards a server scope's sends when that scope ends, as its private cache is. */
export function dropScopeSends(scope: ServerScope) {
  const prefix = `${scopeKey(scope)}|`
  const ended = [...pendingSends.keys()].filter((key) => key.startsWith(prefix))
  const floorsEnded = [...floors.keys()].filter((key) => key.startsWith(prefix))
  floorsEnded.forEach((key) => floors.delete(key))
  ended.forEach((key) => {
    pendingSends.delete(key)
    sessions.delete(key)
  })
  if (ended.length) {
    listeners.forEach((listener) => listener())
  }
}

/** The current scope's key for a session's sends. */
export function usePendingSendKey(batchId: string, jobId: string) {
  return pendingSendKey(useServerScope(), batchId, jobId)
}

/** The session a store key names, as `pendingSendKey` built it. */
export type PendingSendSession = { storeKey: string; batchId: string; jobId: string }

/**
 * Starts a send, or a retry of one, with this delivery key. A new send's row is newer than every
 * row this session's earlier sends were saved as, so its text match starts above them too, even
 * once those sends have been retired.
 */
export function startPendingSend(session: PendingSendSession, send: PendingSend) {
  const sends = pendingSends.get(session.storeKey) ?? NONE
  const known = sends.find((candidate) => candidate.key === send.key)
  const savedSeqs = sends.flatMap((candidate) =>
    candidate.seq === undefined ? [] : [candidate.seq],
  )
  const after = known
    ? known.after
    : Math.max(send.after, floors.get(session.storeKey) ?? 0, ...savedSeqs)
  sessions.set(session.storeKey, { batchId: session.batchId, jobId: session.jobId })
  const started = { ...send, after }
  publish(
    session.storeKey,
    known
      ? sends.map((candidate) => (candidate.key === send.key ? started : candidate))
      : [...sends, started],
  )
}

/**
 * Records how a send ended, only while the send is still held: one whose scope ended, or that was
 * discarded, while its request ran stays gone.
 */
export function settlePendingSend(storeKey: string, send: PendingSend) {
  const sends = pendingSends.get(storeKey) ?? NONE
  const held = sends.find((candidate) => candidate.key === send.key)
  if (!held) {
    return
  }
  // The floor set when the send started stays, so a retry still matches only newer rows.
  const settled = { ...send, after: held.after }
  publish(
    storeKey,
    sends.map((candidate) => (candidate.key === send.key ? settled : candidate)),
  )
}

/** Drops the send with this delivery key, as Discard does. */
export function dropPendingSend(storeKey: string, key: string) {
  const sends = pendingSends.get(storeKey) ?? NONE
  publish(
    storeKey,
    sends.filter((candidate) => candidate.key !== key),
  )
}

/** A send still holds the message box: one in flight or unconfirmed, not one already saved. */
export function hasPendingSend(storeKey: string) {
  return (pendingSends.get(storeKey) ?? NONE).some((send) => send.status !== 'saved')
}

/** The session's sends, oldest first. */
export function usePendingSends(storeKey: string) {
  return useSyncExternalStore(subscribe, () => pendingSends.get(storeKey) ?? NONE)
}

type HistoryRow = { id: string; who: string; details: { kind: string; text?: string } }

/** The inbox sequence of a history row, from its `inbox:<seq>` ID; 0 for any other row. */
export function inboxSeq(id: string) {
  const match = /^inbox:(\d+)$/.exec(id)

  return match ? Number(match[1]) : 0
}

/** The newest inbox row a history shows, which a send records as its starting point. */
export function newestInboxSeq(entries: readonly { id: string }[]) {
  return entries.reduce((newest, entry) => Math.max(newest, inboxSeq(entry.id)), 0)
}

type HeldRead = HistoryReadOrder & { entries: readonly HistoryRow[] }

/**
 * Whether a read already accounts for a saved send: it holds the send's row or a newer inbox row,
 * or it started after the receipt, so a row that has left its newest page is older than the page.
 */
function readCovers(read: HeldRead, send: PendingSend) {
  const started = read.readOrder
  const startedAfterReceipt =
    started !== undefined && send.savedOrder !== undefined && started > send.savedOrder
  if (startedAfterReceipt) {
    return true
  }

  return send.seq !== undefined && newestInboxSeq(read.entries) >= send.seq
}

/**
 * The messages to show at the end of a history, "Sending…" or "Saved", that the read doesn't hold
 * yet. A saved send shows until the read covers it (`readCovers`), so a row that later leaves the
 * newest page never returns. Before its receipt, a send is matched to a newer chat row with its
 * text, each row to one send in the order sent.
 */
export function unreadPendingSends(sends: readonly PendingSend[], read: HeldRead) {
  const { entries } = read
  const claimed = new Set(sends.flatMap((send) => (send.seq === undefined ? [] : [send.seq])))
  const shown: PendingSend[] = []
  for (const send of sends) {
    if (send.status === 'unconfirmed') {
      continue
    }
    if (send.status === 'saved') {
      if (!readCovers(read, send)) {
        shown.push(send)
      }
      continue
    }
    const row = entries.find((entry) => {
      const seq = inboxSeq(entry.id)
      return (
        seq > send.after &&
        !claimed.has(seq) &&
        entry.who === 'operator' &&
        entry.details.kind === 'chat' &&
        entry.details.text === send.text
      )
    })
    if (row) {
      claimed.add(inboxSeq(row.id))
    } else {
      shown.push(send)
    }
  }

  return shown
}

/**
 * The session's history reads that a surface can show, the drawer's and the session page's, or
 * null while one is being read: a request in flight may have started before a receipt, so its
 * result is unknown until it lands.
 */
function settledReads(client: QueryClient, scope: ServerScope, batchId: string, jobId: string) {
  const reads: HeldRead[] = []
  for (const which of ['newest', 'page'] as const) {
    const key = serverQueryKey(scope, 'processing', batchId, 'history', jobId, which)
    const query = client.getQueryCache().find<HeldRead>({ queryKey: key, exact: true })
    if (query?.state.fetchStatus === 'fetching') {
      return null
    }
    const read = query?.state.data
    if (read) {
      reads.push(read)
    }
  }

  return reads
}

/**
 * Drops this scope's saved sends that every held history read covers, once none is being read. A
 * read not in the cache has no older copy to show: the surface that mounts it reads afresh.
 */
export function retireCoveredSends(client: QueryClient, scope: ServerScope) {
  const prefix = `${scopeKey(scope)}|`
  for (const [storeKey, sends] of [...pendingSends]) {
    const session = sessions.get(storeKey)
    if (!storeKey.startsWith(prefix) || !session) {
      continue
    }
    const reads = settledReads(client, scope, session.batchId, session.jobId)
    if (!reads) {
      continue
    }
    const kept = sends.filter(
      (send) => send.status !== 'saved' || !reads.every((read) => readCovers(read, send)),
    )
    if (kept.length !== sends.length) {
      publish(storeKey, kept)
    }
  }
}
