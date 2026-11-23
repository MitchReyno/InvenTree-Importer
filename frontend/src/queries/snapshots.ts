import { validate } from '@invimport/contracts'
import { APP_BUILD } from '#/build'
import { serverScopeIdentity, type ServerScope } from './scope'
import { SNAPSHOT_KINDS, type SnapshotData, type SnapshotKind } from './snapshot-projections'

const KEY_PREFIX = 'bench-intake.snapshot.'
const ENTRY_VERSION = 1
/** A tab left for longer than a working day shows no stale inventory on reload. */
export const SNAPSHOT_MAX_AGE_MS = 12 * 60 * 60 * 1000
/** A projection larger than this is not stored, so one read can't crowd out the others. */
export const MAX_SNAPSHOT_BYTES = 1024 * 1024
/** At most one write per resource per interval; a newer read waiting replaces the one before. */
export const SNAPSHOT_WRITE_INTERVAL_MS = 1000

interface StoredEntry {
  version: number
  build: string
  actorId: string
  targetId: string
  targetContextId: string
  writtenAt: number
  data: unknown
}

interface PendingWrite {
  scope: ServerScope
  key: string
  data: unknown
  timer: ReturnType<typeof setTimeout>
}

export interface SnapshotStoreOptions {
  storage: () => Storage | undefined
  now: () => number
  build: string
  /** The largest serialised entry stored; `MAX_SNAPSHOT_BYTES` unless a test lowers it. */
  maxBytes?: number
}

/**
 * Display-only snapshots of allowlisted reads in the tab's session storage, so a reload shows the
 * last data at once. They are never put into the query cache and never verify a command.
 */
export class SnapshotStore {
  readonly #options: SnapshotStoreOptions
  readonly #lastWrite = new Map<string, number>()
  readonly #pending = new Map<string, PendingWrite>()
  #lastFailure: string | null = null

  constructor(options: SnapshotStoreOptions) {
    this.#options = options
  }

  /** The stored snapshot for this scope and resource, or nothing if it is absent or unusable. */
  read<K extends SnapshotKind>(
    kind: K,
    scope: ServerScope,
    resourceId: string,
  ): SnapshotData[K] | undefined {
    const raw = this.#get(snapshotKey(kind, scope, resourceId))
    const entry = raw === null ? undefined : this.#usableEntry(raw, scope)
    if (!entry) {
      return undefined
    }
    try {
      validate(SNAPSHOT_KINDS[kind].schema, entry.data)
    } catch {
      return undefined
    }
    return entry.data as SnapshotData[K]
  }

  /** Stores a verified read's projection, at most once per resource per write interval. */
  write<K extends SnapshotKind>(
    kind: K,
    scope: ServerScope,
    resourceId: string,
    read: SnapshotData[K],
  ) {
    const projection = SNAPSHOT_KINDS[kind]
    const data = projection.project(read)
    try {
      validate(SNAPSHOT_KINDS[kind].schema, data)
    } catch {
      return
    }
    const key = snapshotKey(kind, scope, resourceId)
    const pending = this.#pending.get(key)
    if (pending) {
      pending.data = data
      return
    }
    const wait = (this.#lastWrite.get(key) ?? -Infinity) + SNAPSHOT_WRITE_INTERVAL_MS
    const delay = wait - this.#options.now()
    if (delay <= 0) {
      this.#store(key, scope, data)
      return
    }
    const timer = setTimeout(() => {
      const waiting = this.#pending.get(key)
      this.#pending.delete(key)
      if (waiting) {
        this.#store(key, waiting.scope, waiting.data)
      }
    }, delay)
    this.#pending.set(key, { scope, key, data, timer })
  }

  /**
   * Keeps only usable snapshots of this scope: other scopes, other builds, expired and malformed
   * entries are deleted unread.
   */
  prune(scope: ServerScope) {
    for (const key of this.#snapshotKeys()) {
      const raw = this.#get(key)
      if (raw === null || !this.#usableEntry(raw, scope)) {
        this.#remove(key)
      }
    }
  }

  /** A scope ends: its snapshots and its waiting writes go. */
  dropScope(scope: ServerScope) {
    const suffix = scopeSuffix(scope)
    for (const [key, pending] of this.#pending) {
      if (key.endsWith(suffix)) {
        clearTimeout(pending.timer)
        this.#pending.delete(key)
      }
    }
    for (const key of this.#snapshotKeys()) {
      if (key.endsWith(suffix)) {
        this.#remove(key)
      }
    }
  }

  /** The last storage failure, for the debug panel; never shown to the operator as an error. */
  lastFailure() {
    return this.#lastFailure
  }

  #store(key: string, scope: ServerScope, data: unknown) {
    const entry: StoredEntry = {
      version: ENTRY_VERSION,
      build: this.#options.build,
      actorId: scope.actorId,
      targetId: scope.targetId,
      targetContextId: scope.targetContextId,
      writtenAt: this.#options.now(),
      data,
    }
    const serialised = JSON.stringify(entry)
    this.#lastWrite.set(key, this.#options.now())
    if (
      new TextEncoder().encode(serialised).length > (this.#options.maxBytes ?? MAX_SNAPSHOT_BYTES)
    ) {
      // An older, smaller snapshot of the same read would now be stale.
      this.#remove(key)
      return
    }
    try {
      this.#options.storage()?.setItem(key, serialised)
    } catch (error) {
      if (isQuotaExceeded(error)) {
        this.#lastFailure = 'Session storage full; snapshots cleared'
        this.#clearAll()
      } else {
        this.#lastFailure = 'Session storage unavailable'
      }
    }
  }

  #usableEntry(raw: string, scope: ServerScope): StoredEntry | undefined {
    let entry: unknown
    try {
      entry = JSON.parse(raw)
    } catch {
      return undefined
    }
    if (!isStoredEntry(entry)) {
      return undefined
    }
    const fresh =
      entry.version === ENTRY_VERSION &&
      entry.build === this.#options.build &&
      this.#options.now() - entry.writtenAt <= SNAPSHOT_MAX_AGE_MS &&
      entry.writtenAt <= this.#options.now()
    const sameScope =
      entry.actorId === scope.actorId &&
      entry.targetId === scope.targetId &&
      entry.targetContextId === scope.targetContextId
    return fresh && sameScope ? entry : undefined
  }

  #clearAll() {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer)
    }
    this.#pending.clear()
    for (const key of this.#snapshotKeys()) {
      this.#remove(key)
    }
  }

  #snapshotKeys() {
    const storage = this.#storage()
    if (!storage) {
      return []
    }
    const keys: string[] = []
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (key?.startsWith(KEY_PREFIX)) {
        keys.push(key)
      }
    }
    return keys
  }

  #get(key: string) {
    try {
      return this.#storage()?.getItem(key) ?? null
    } catch {
      return null
    }
  }

  #remove(key: string) {
    try {
      this.#storage()?.removeItem(key)
    } catch {
      // Unavailable storage holds nothing to remove.
    }
  }

  #storage() {
    try {
      return this.#options.storage()
    } catch {
      return undefined
    }
  }
}

function isStoredEntry(value: unknown): value is StoredEntry {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const entry = value as Record<string, unknown>
  return (
    typeof entry.version === 'number' &&
    typeof entry.build === 'string' &&
    typeof entry.actorId === 'string' &&
    typeof entry.targetId === 'string' &&
    typeof entry.targetContextId === 'string' &&
    typeof entry.writtenAt === 'number' &&
    'data' in entry
  )
}

function isQuotaExceeded(error: unknown) {
  return error instanceof DOMException && error.name === 'QuotaExceededError'
}

/** A short, stable hash of the scope, so keys of different scopes never collide or mix. */
function scopeSuffix(scope: ServerScope) {
  const identity = serverScopeIdentity(scope)
  // FNV-1a, 32-bit: a key namespace, not a security boundary; the entry repeats the scope.
  let hash = 0x811c9dc5
  for (let index = 0; index < identity.length; index += 1) {
    hash ^= identity.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `:${(hash >>> 0).toString(16).padStart(8, '0')}`
}

function snapshotKey(kind: SnapshotKind, scope: ServerScope, resourceId: string) {
  return `${KEY_PREFIX}${kind}:${resourceId}${scopeSuffix(scope)}`
}

/** The app's snapshot store over this tab's session storage. */
export const snapshots = new SnapshotStore({
  storage: () => (typeof sessionStorage === 'undefined' ? undefined : sessionStorage),
  now: () => Date.now(),
  build: APP_BUILD,
})
