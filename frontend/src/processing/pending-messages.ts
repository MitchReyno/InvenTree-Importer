/**
 * Unsent messages to a session, kept outside the components so leaving the page keeps both the
 * text and its idempotency key: sending it again after an unconfirmed send cannot queue it twice.
 */
export type PendingMessage = { text: string; key: string | null }

const pending = new Map<string, PendingMessage>()

export function pendingMessage(storeKey: string): PendingMessage {
  return pending.get(storeKey) ?? { text: '', key: null }
}

/** Editing the text starts a new message, so it drops any earlier key. */
export function editPending(storeKey: string, text: string) {
  if (text) {
    pending.set(storeKey, { text, key: null })
  } else {
    pending.delete(storeKey)
  }
}

/** The key for sending the kept text, made once and reused until the send is confirmed. */
export function sendKey(storeKey: string, text: string) {
  const current = pending.get(storeKey)
  const key = current?.key ?? crypto.randomUUID()
  pending.set(storeKey, { text, key })
  return key
}

export function confirmPending(storeKey: string) {
  pending.delete(storeKey)
}

/** Drops every unsent message whose key starts with `prefix`, when its drafts are discarded. */
export function clearPending(prefix: string) {
  for (const key of [...pending.keys()]) {
    if (key.startsWith(prefix)) {
      pending.delete(key)
    }
  }
}
