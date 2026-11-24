import { useSyncExternalStore } from 'react'

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
 * Sends outlive the composer for as long as the page is open. An entry is written before the
 * request starts and removed only when it is confirmed or explicitly discarded.
 */
const pendingSends = new Map<string, PendingSend>()
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function setPendingSend(storeKey: string, value: PendingSend | undefined) {
  if (value) {
    pendingSends.set(storeKey, value)
  } else {
    pendingSends.delete(storeKey)
  }
  listeners.forEach((listener) => listener())
}

/** A send still holds the message box: one in flight or unconfirmed, not one already saved. */
export function hasPendingSend(storeKey: string) {
  const pending = pendingSends.get(storeKey)

  return pending !== undefined && pending.status !== 'saved'
}

/** The session's message in flight or unconfirmed, which the history shows at its end. */
export function usePendingSend(storeKey: string) {
  return useSyncExternalStore(subscribe, () => pendingSends.get(storeKey))
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
 * The message to show at the end of the history with "Sending…", or "Saved" once confirmed, until
 * a read holds it: by its saved row's sequence, or, before the receipt arrives, by the first newer
 * chat row with the same text.
 */
export function unreadPendingSend(
  pending: PendingSend | undefined,
  entries: readonly HistoryRow[],
) {
  if (!pending || pending.status === 'unconfirmed') {
    return undefined
  }
  const arrived = entries.some((entry) => {
    const seq = inboxSeq(entry.id)
    if (pending.seq !== undefined) {
      return seq === pending.seq
    }
    return (
      seq > pending.after &&
      entry.who === 'operator' &&
      entry.details.kind === 'chat' &&
      entry.details.text === pending.text
    )
  })

  return arrived ? undefined : pending
}
