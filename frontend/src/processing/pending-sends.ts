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
 * delivery key, in the order sent, from before the request starts until a history read holds the
 * saved row or the operator discards an unconfirmed one.
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

function publish(storeKey: string, sends: readonly PendingSend[]) {
  if (sends.length) {
    pendingSends.set(storeKey, sends)
  } else {
    pendingSends.delete(storeKey)
  }
  listeners.forEach((listener) => listener())
}

/** One session's sends within one server scope, so another origin or account never sees them. */
export function pendingSendKey(scope: ServerScope, batchId: string, jobId: string) {
  return [scope.origin, scope.actorId, scope.targetId, scope.targetContextId, batchId, jobId].join(
    '|',
  )
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

/**
 * Whether a read holds the send's row: by its saved row's sequence, or, before the receipt
 * arrives, by the first newer chat row with the same text.
 */
function arrived(send: PendingSend, entries: readonly HistoryRow[]) {
  return entries.some((entry) => {
    const seq = inboxSeq(entry.id)
    if (send.seq !== undefined) {
      return seq === send.seq
    }
    return (
      seq > send.after &&
      entry.who === 'operator' &&
      entry.details.kind === 'chat' &&
      entry.details.text === send.text
    )
  })
}

/**
 * The messages to show at the end of the history, "Sending…" or "Saved", until a read holds them.
 */
export function unreadPendingSends(sends: readonly PendingSend[], entries: readonly HistoryRow[]) {
  return sends.filter((send) => send.status !== 'unconfirmed' && !arrived(send, entries))
}

/**
 * Retires saved sends a read now holds, so a row that later ages out of the newest page never
 * comes back as pending.
 */
export function retireArrivedSends(storeKey: string, entries: readonly HistoryRow[]) {
  const sends = pendingSends.get(storeKey) ?? NONE
  const kept = sends.filter((send) => send.status !== 'saved' || !arrived(send, entries))
  if (kept.length !== sends.length) {
    publish(storeKey, kept)
  }
}
