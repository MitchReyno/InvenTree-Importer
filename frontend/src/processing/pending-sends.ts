import { useSyncExternalStore } from 'react'
import { useServerScope } from '#/context'
import type { ServerScope } from '#/queries/scope'

/**
 * A chat message being sent, one whose send went unconfirmed, or one saved but not yet in a
 * history read. `after` is the newest inbox row the history showed when it was sent, and `seq`
 * the saved row's own, so the history can tell when the message has reached it.
 */
export type PendingSend = {
  text: string
  key: string
  after: number
  status: 'sending' | 'unconfirmed' | 'saved'
  seq?: number
}

/**
 * Sends outlive the composer for as long as the page is open. Each session's sends are kept by
 * delivery key, in the order sent, from before the request starts; an unconfirmed one until the
 * operator retries or discards it, and a saved one with its row's inbox sequence, so each surface
 * can tell from its own read whether it holds the row yet.
 */
const pendingSends = new Map<string, readonly PendingSend[]>()
const listeners = new Set<() => void>()
const NONE: readonly PendingSend[] = []

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function publish(storeKey: string, all: readonly PendingSend[]) {
  const saved = all.filter((send) => send.status === 'saved')
  const dropped = new Set(saved.slice(0, -MAX_SAVED_SENDS))
  const sends = all.filter((send) => !dropped.has(send))
  if (sends.length) {
    pendingSends.set(storeKey, sends)
  } else {
    pendingSends.delete(storeKey)
  }
  listeners.forEach((listener) => listener())
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
  ended.forEach((key) => pendingSends.delete(key))
  if (ended.length) {
    listeners.forEach((listener) => listener())
  }
}

/** The current scope's key for a session's sends. */
export function usePendingSendKey(batchId: string, jobId: string) {
  return pendingSendKey(useServerScope(), batchId, jobId)
}

/** Records or replaces the send with this delivery key. */
export function setPendingSend(storeKey: string, send: PendingSend) {
  const sends = pendingSends.get(storeKey) ?? NONE
  const known = sends.some((candidate) => candidate.key === send.key)
  publish(
    storeKey,
    known
      ? sends.map((candidate) => (candidate.key === send.key ? send : candidate))
      : [...sends, send],
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

/** At most this many saved sends are kept per session; older ones are long in its history. */
const MAX_SAVED_SENDS = 20

/**
 * The messages to show at the end of a history, "Sending…" or "Saved", that the read doesn't hold
 * yet. A saved send shows while the read is older than its row: it holds neither that row nor any
 * newer inbox row, so a row that later leaves the newest page never returns. Before its receipt,
 * a send is matched to a newer chat row with its text, each row to one send in the order sent.
 */
export function unreadPendingSends(sends: readonly PendingSend[], entries: readonly HistoryRow[]) {
  const newest = newestInboxSeq(entries)
  const claimed = new Set(sends.flatMap((send) => (send.seq === undefined ? [] : [send.seq])))
  const shown: PendingSend[] = []
  for (const send of sends) {
    if (send.status === 'unconfirmed') {
      continue
    }
    if (send.seq !== undefined) {
      if (newest < send.seq) {
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
