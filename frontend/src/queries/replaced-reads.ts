import {
  hashKey,
  isCancelledError,
  type Query,
  type QueryCacheNotifyEvent,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query'

/** How long an awaited read waits, from its first cancel, for the read that replaced it. */
export const REPLACED_READ_WAIT_MS = 10_000

/**
 * Live reconciliation invalidates right after its cancel, which starts the replacement for every
 * observed key. A key it doesn't refetch, because nothing observes it, is read here after this.
 */
export const REPLACEMENT_START_MS = 100

export type ReadUnavailableCause = 'failed' | 'paused' | 'timeout'

/** The read that replaced a cancelled one failed, paused, or didn't settle in time. */
export class ReadUnavailable extends Error {
  readonly reason: ReadUnavailableCause

  constructor(reason: ReadUnavailableCause, cause?: unknown) {
    super(`read_unavailable_${reason}`, { cause })
    this.name = 'ReadUnavailable'
    this.reason = reason
  }
}

/**
 * The caller stopped waiting (it unmounted or its operation ended), or the query itself was
 * removed or its scope changed. Nothing failed, so callers show nothing.
 */
export class ReadAbandoned extends Error {
  constructor() {
    super('read_abandoned')
    this.name = 'ReadAbandoned'
  }
}

export interface ReplacedReadOptions<T> {
  client: QueryClient
  queryKey: QueryKey
  /** Starts (or joins) a read of the key and settles with its data; also the fallback read. */
  read: () => Promise<T>
  /** The caller's lifetime: once aborted it stops waiting with `ReadAbandoned`. */
  signal: AbortSignal
  /** Told when a replacement didn't settle in time, so the key reads as unavailable. */
  onTimeout?: () => void
}

/**
 * Awaits a read of a key. When live reconciliation cancels it, it waits for the read that replaced
 * it instead of failing: the next settled result of the same query from a request started after
 * the cancel, for at most `REPLACED_READ_WAIT_MS` from the first cancel. From the start it stops
 * with `ReadAbandoned` once the caller's signal aborts or the query is removed, and with
 * `ReadUnavailable` once the read pauses. A cancelled request still never verifies a command; the
 * replacement verifies through its own generation in the registry. Errors other than a cancel are
 * the read's own and are passed on unchanged.
 */
export function awaitReadReplacingCancels<T>({
  client,
  queryKey,
  read,
  signal,
  onTimeout,
}: ReplacedReadOptions<T>): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(new ReadAbandoned())
  }
  const reading = read()
  // The read creates the query if it didn't exist; a later query under the key is another one.
  const query = client.getQueryCache().get(hashKey(queryKey))
  if (!query) {
    return reading
  }

  return new Promise<T>((resolve, reject) => {
    const wait = new ReplacementWait({ client, query, read, signal, onTimeout, resolve, reject })
    wait.failIfPaused()
    reading.then(
      (data) => wait.firstReadSettled(() => resolve(data)),
      (error: unknown) => wait.firstReadFailed(error),
    )
  })
}

type WaitOptions<T> = Pick<ReplacedReadOptions<T>, 'client' | 'read' | 'signal' | 'onTimeout'> & {
  query: Query
  resolve: (data: T) => void
  reject: (error: unknown) => void
}

/** One caller's wait on a query: its first read, then any replacement after a cancel. */
class ReplacementWait<T> {
  readonly #options: WaitOptions<T>
  #settled = false
  /** Waiting for a replacement since the first cancel. */
  #replacing = false
  /** A request started since the last cancel is running. */
  #replacementRunning = false
  #deadline: ReturnType<typeof setTimeout> | undefined
  #startTimer: ReturnType<typeof setTimeout> | undefined
  readonly #unsubscribe: () => void

  constructor(options: WaitOptions<T>) {
    this.#options = options
    this.#unsubscribe = options.client.getQueryCache().subscribe((event) => this.#onEvent(event))
    options.signal.addEventListener('abort', this.#abandon)
  }

  /** A read already paused when the wait starts sends no further event. */
  failIfPaused() {
    if (this.#options.query.state.fetchStatus === 'paused') {
      this.#fail(new ReadUnavailable('paused'))
    }
  }

  firstReadSettled(settle: () => void) {
    if (!this.#replacing) {
      this.#finish(settle)
    }
  }

  firstReadFailed(error: unknown) {
    if (this.#settled || this.#replacing) {
      return
    }
    if (!isCancelledError(error)) {
      this.#finish(() => this.#options.reject(error))
      return
    }
    const { client, query } = this.#options
    if (client.getQueryCache().get(query.queryHash) !== query) {
      this.#abandon()
      return
    }
    this.#replacing = true
    this.#deadline = setTimeout(() => {
      this.#options.onTimeout?.()
      this.#fail(new ReadUnavailable('timeout'))
    }, REPLACED_READ_WAIT_MS)
    // A request running now started after the cancel, which set the query idle.
    this.#replacementRunning = query.state.fetchStatus === 'fetching'
    if (query.state.fetchStatus === 'paused') {
      this.#fail(new ReadUnavailable('paused'))
    } else if (!this.#replacementRunning) {
      this.#startIfNoneStarts()
    }
  }

  readonly #abandon = () => {
    this.#fail(new ReadAbandoned())
  }

  #fail(error: Error) {
    this.#finish(() => this.#options.reject(error))
  }

  #finish(settle: () => void) {
    if (this.#settled) {
      return
    }
    this.#settled = true
    clearTimeout(this.#deadline)
    clearTimeout(this.#startTimer)
    this.#unsubscribe()
    this.#options.signal.removeEventListener('abort', this.#abandon)
    settle()
  }

  #startIfNoneStarts() {
    clearTimeout(this.#startTimer)
    this.#startTimer = setTimeout(() => {
      if (!this.#replacementRunning && this.#options.query.state.fetchStatus === 'idle') {
        // Its outcome arrives as cache events, like any other replacement's.
        this.#options.read().catch(() => undefined)
      }
    }, REPLACEMENT_START_MS)
  }

  #onEvent(event: QueryCacheNotifyEvent) {
    const query = this.#options.query
    if (event.query !== query) {
      return
    }
    if (event.type === 'removed') {
      this.#abandon()
      return
    }
    if (event.type !== 'updated') {
      return
    }
    const action = event.action
    if (action.type === 'pause') {
      this.#fail(new ReadUnavailable('paused'))
      return
    }
    if (!this.#replacing) {
      // The first read settles through its own promise.
      return
    }
    switch (action.type) {
      case 'fetch':
        this.#replacementRunning = true
        return
      case 'success':
        // A cache write is not a read.
        if (this.#replacementRunning && action.manual !== true) {
          this.#finish(() => this.#options.resolve(query.state.data as T))
        }
        return
      case 'error':
        if (isCancelledError(action.error)) {
          this.#replacementRunning = false
          this.#startIfNoneStarts()
        } else if (this.#replacementRunning) {
          this.#fail(new ReadUnavailable('failed', action.error))
        }
        return
      case 'setState':
        // Another cancel's revert: keep waiting, under the first deadline.
        if (query.state.fetchStatus === 'idle') {
          this.#replacementRunning = false
          this.#startIfNoneStarts()
        }
        return
      case 'failed':
      case 'continue':
      case 'invalidate':
        return
    }
  }
}
