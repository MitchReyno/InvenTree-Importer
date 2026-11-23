import {
  hashKey,
  type QueryCacheNotifyEvent,
  type QueryClient,
  type QueryFilters,
  type QueryFunctionContext,
  type QueryKey,
} from '@tanstack/react-query'

/** A request a key's query function started: its number for that key and its global start order. */
interface Request {
  generation: number
  startOrder: number
}

interface KeyEntry {
  generations: number
  /** The newest request started; only its result can be adopted. */
  newest?: Request
  cancelled: Set<number>
  /** The newest request's result, returned and waiting for its cache update. */
  produced?: number
  /** The request whose result the cache holds, while no manual write, failure or pause has replaced it. */
  adopted?: Request
  /** The data that result put in the cache; a state change keeps the proof only if it restores it. */
  adoptedData?: unknown
  /** The query's data update count at the last manual write, to tell which write is newest. */
  manualUpdate?: number
  /** Each mounted observer's mount order. */
  observers: Map<symbol, number>
  followUpScheduled: boolean
}

/**
 * Which cached reads came from an HTTP request, per query key, so commands can tell a verified read
 * from a cache write, a restored snapshot or an older request. One registry belongs to one
 * `QueryClient`, and so to one server scope: a scope change starts a new registry.
 *
 * Orders are one counter shared by request starts, observer mounts and live hints, so "started
 * after" compares any two of them.
 */
export class FreshReadRegistry {
  readonly #client: QueryClient
  readonly #entries = new Map<string, KeyEntry>()
  readonly #listeners = new Set<() => void>()
  #order = 0
  #lastHint = 0
  #version = 0

  #unsubscribeCache: (() => void) | null = null

  constructor(client: QueryClient) {
    this.#client = client
    this.attach()
  }

  /** Follows the client's cache; the owner of the client attaches and detaches it. */
  attach() {
    this.#unsubscribeCache ??= this.#client
      .getQueryCache()
      .subscribe((event) => this.#onCacheEvent(event))
  }

  detach() {
    this.#unsubscribeCache?.()
    this.#unsubscribeCache = null
  }

  /** A position in the shared order, taken when an observer mounts or a request starts. */
  nextOrder() {
    this.#order += 1
    return this.#order
  }

  /** Changes on every adoption, clear or hint, for `useSyncExternalStore`. */
  version() {
    return this.#version
  }

  subscribe(listener: () => void) {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  /** Wraps a query function so each request it starts is numbered and its result attributed. */
  track<T>(
    queryKey: QueryKey,
    read: (context: QueryFunctionContext) => Promise<T>,
  ): (context: QueryFunctionContext) => Promise<T> {
    const hash = hashKey(queryKey)

    return async (context) => {
      const request = this.#begin(hash)
      const data = await read(context)
      this.#produced(hash, request.generation)
      return data
    }
  }

  /** Mounts an observer of a key; the returned cleanup unmounts it. */
  observe(queryKey: QueryKey, observer: symbol, mountOrder: number) {
    const hash = hashKey(queryKey)
    this.#entry(hash).observers.set(observer, mountOrder)

    return () => {
      this.#entries.get(hash)?.observers.delete(observer)
    }
  }

  /** The adopted request's start order: a new value for each verified read, even of equal data. */
  adoptedOrder(queryKey: QueryKey) {
    return this.#entries.get(hashKey(queryKey))?.adopted?.startOrder
  }

  /** Whether the cache holds a result whose request started after this observer mounted. */
  verified(queryKey: QueryKey, mountOrder: number | undefined) {
    const adopted = this.#entries.get(hashKey(queryKey))?.adopted
    return mountOrder !== undefined && adopted !== undefined && adopted.startOrder > mountOrder
  }

  /**
   * Whether a verified result's request also started after the last live hint, with no newer read
   * in flight, so a command that carries no revision acts on state at least as new as the newest
   * change the app heard of.
   */
  settledAfterHint(queryKey: QueryKey, mountOrder: number | undefined) {
    const adopted = this.#entries.get(hashKey(queryKey))?.adopted
    const settled = this.#client.getQueryState(queryKey)?.fetchStatus === 'idle'
    return (
      settled &&
      this.verified(queryKey, mountOrder) &&
      adopted !== undefined &&
      adopted.startOrder > this.#lastHint
    )
  }

  /**
   * Holds a command with no revision until the cache adopts a read of this key that started after
   * this call and after the last live hint. `readAgain` starts that read itself, so it needs no
   * mounted page; `ready()` checks again at dispatch.
   */
  requestRead<T>(queryKey: QueryKey, read: () => Promise<T>): ReadRequest {
    const requested = this.nextOrder()

    const ready = () => {
      const state = this.#client.getQueryState(queryKey)
      return state?.status === 'success' && this.settledAfterHint(queryKey, requested)
    }

    const readAgain = async () => {
      await this.#client.fetchQuery({
        queryKey,
        queryFn: this.track(queryKey, () => read()),
        staleTime: 0,
      })
    }

    return { ready, readAgain }
  }

  /** Records that a live hint arrived, before any reconciliation it causes. */
  noteHint() {
    this.#lastHint = this.nextOrder()
    this.#changed()
  }

  /**
   * Cancels matching in-flight requests so they can never verify, keeping the result already
   * adopted: a reverting or silent cancel leaves that same data in the cache.
   */
  async cancel(filters: QueryFilters, options: { silent?: boolean; revert?: boolean } = {}) {
    for (const query of this.#client.getQueryCache().findAll(filters)) {
      const entry = this.#entries.get(query.queryHash)
      if (entry?.newest && query.state.fetchStatus !== 'idle') {
        entry.cancelled.add(entry.newest.generation)
        entry.produced = undefined
      }
    }
    await this.#client.cancelQueries(filters, options)
  }

  #entry(hash: string) {
    let entry = this.#entries.get(hash)
    if (!entry) {
      entry = {
        generations: 0,
        cancelled: new Set(),
        observers: new Map(),
        followUpScheduled: false,
      }
      this.#entries.set(hash, entry)
    }
    return entry
  }

  #begin(hash: string): Request {
    const entry = this.#entry(hash)
    entry.generations += 1
    entry.newest = { generation: entry.generations, startOrder: this.nextOrder() }
    entry.produced = undefined
    return entry.newest
  }

  #produced(hash: string, generation: number) {
    const entry = this.#entries.get(hash)
    if (entry?.newest?.generation === generation && !entry.cancelled.has(generation)) {
      entry.produced = generation
    }
  }

  #onCacheEvent(event: QueryCacheNotifyEvent) {
    const hash = event.query.queryHash
    if (event.type === 'removed') {
      const entry = this.#entries.get(hash)
      if (entry) {
        // Only mounted observers outlive their query; its requests can no longer publish.
        this.#entries.set(hash, {
          generations: entry.generations,
          cancelled: new Set(),
          observers: entry.observers,
          followUpScheduled: false,
        })
        this.#changed()
      }
      return
    }
    if (event.type !== 'updated') {
      return
    }
    const entry = this.#entries.get(hash)
    if (!entry) {
      return
    }
    const action = event.action
    switch (action.type) {
      case 'success':
        this.#settleSuccess(entry, hash, action.manual === true, event.query.state)
        return
      case 'error':
      case 'pause':
        this.#clear(entry)
        return
      case 'setState':
        // A reverting cancel restores the adopted data itself; any other state replaces the proof.
        if (
          event.query.state.data !== entry.adoptedData ||
          event.query.state.status !== 'success'
        ) {
          this.#clear(entry)
        }
        return
      case 'fetch':
      case 'failed':
      case 'continue':
      case 'invalidate':
        return
    }
  }

  #settleSuccess(
    entry: KeyEntry,
    hash: string,
    manual: boolean,
    state: { data: unknown; dataUpdateCount: number },
  ) {
    if (manual) {
      // A cache write between a request's return and its adoption keeps that request pending.
      entry.manualUpdate = state.dataUpdateCount
      this.#clear(entry)
      return
    }
    const produced = entry.produced
    entry.produced = undefined
    // A write made while this result was being published (an observer writing in its callback)
    // is newer than the result, so the cache no longer holds what the request read.
    if (entry.manualUpdate === state.dataUpdateCount) {
      this.#clear(entry)
      return
    }
    // Only the newest request's own result is adopted; a manual write or any other success is not.
    const adoptable =
      produced !== undefined &&
      entry.newest?.generation === produced &&
      !entry.cancelled.has(produced)
    if (!adoptable) {
      this.#clear(entry)
      return
    }
    entry.adopted = entry.newest
    entry.adoptedData = state.data
    // Only the newest request can publish, so older cancelled markers are no longer needed.
    entry.cancelled.clear()
    this.#changed()
    this.#followUpJoinedObservers(entry, hash)
  }

  #clear(entry: KeyEntry) {
    entry.adoptedData = undefined
    if (entry.adopted !== undefined) {
      entry.adopted = undefined
      this.#changed()
    }
  }

  /**
   * An observer that mounted while a request was already running joined it, so that result can't
   * verify it. One more fetch per key follows, so it gets a read of its own even with polling off.
   */
  #followUpJoinedObservers(entry: KeyEntry, hash: string) {
    const newestMount = Math.max(0, ...entry.observers.values())
    if (entry.followUpScheduled || !entry.adopted || entry.adopted.startOrder > newestMount) {
      return
    }
    entry.followUpScheduled = true
    // Outside the cache notification that adopted the result.
    queueMicrotask(() => {
      entry.followUpScheduled = false
      const query = this.#client.getQueryCache().get(hash)
      const stillNeeded =
        query !== undefined &&
        entry.newest !== undefined &&
        entry.newest.startOrder < Math.max(0, ...entry.observers.values())
      if (stillNeeded) {
        void this.#client.refetchQueries({ queryKey: query.queryKey, exact: true, type: 'active' })
      }
    })
  }

  #changed() {
    this.#version += 1
    for (const listener of this.#listeners) {
      listener()
    }
  }
}

/** A held command's wait for a read started after it was asked for. */
export interface ReadRequest {
  ready: () => boolean
  /** Reads the key (joining a read already running); rejects when that read fails. */
  readAgain: () => Promise<void>
}

const registries = new WeakMap<QueryClient, FreshReadRegistry>()

/** The fresh-read registry of a query client, created on first use. */
export function freshReads(client: QueryClient) {
  let registry = registries.get(client)
  if (!registry) {
    registry = new FreshReadRegistry(client)
    registries.set(client, registry)
  }
  return registry
}

/** Cancels reads through the registry, so a cancelled request can never verify a command. */
export function cancelVerified(
  client: QueryClient,
  filters: QueryFilters,
  options?: { silent?: boolean; revert?: boolean },
) {
  return freshReads(client).cancel(filters, options)
}
