/** A confirmed command whose own Processing read failed, and the status shown meanwhile. */
export type SavedUnread = {
  /** The last network read adopted when it failed; a newer one ends the message. */
  lastRead: number | undefined
  /** When the status shown was read. */
  shownAt: number
}

/**
 * Keeps Processing's "Saved. Showing the last status from…" across its remounts: a confirmed
 * answer reloads the batch, which re-keys Processing. `Batch` owns one store per batch.
 */
export function createSavedStatus() {
  let value: SavedUnread | null = null
  let version = 0
  const listeners = new Set<() => void>()

  return {
    get: () => value,
    set(next: SavedUnread | null) {
      value = next
      version += 1
      for (const listener of listeners) {
        listener()
      }
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    version: () => version,
  }
}

export type SavedStatusStore = ReturnType<typeof createSavedStatus>
