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
}

/**
 * Awaits a read of a key. When live reconciliation cancels it, it waits for the read that replaced
 * it instead of failing: the next settled result of the same query from a request started after
 * the cancel, for at most `REPLACED_READ_WAIT_MS` from the first cancel. A cancelled request still
 * never verifies a command; the replacement verifies through its own generation in the registry.
 * Errors other than a cancel are the read's own and are passed on unchanged.
 */
export async function readReplacingCancels<T>({
  client,
  queryKey,
  read,
  signal,
}: ReplacedReadOptions<T>): Promise<T> {
  if (signal.aborted) {
    throw new ReadAbandoned()
  }
  const reading = read()
  // The read creates the query if it didn't exist; a later query under the key is another one.
  const query = client.getQueryCache().get(hashKey(queryKey))
  try {
    return await reading
  } catch (error) {
    if (!isCancelledError(error)) {
      throw error
    }
  }
  if (signal.aborted || !query || client.getQueryCache().get(query.queryHash) !== query) {
    throw new ReadAbandoned()
  }

  return awaitReplacement({ client, query, read, signal })
}

function awaitReplacement<T>({
  client,
  query,
  read,
  signal,
}: Omit<ReplacedReadOptions<T>, 'queryKey'> & { query: Query }): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    // A request running now started after the cancel, which set the query idle.
    let replacing = query.state.fetchStatus === 'fetching'
    let startTimer: ReturnType<typeof setTimeout> | undefined
    const deadline = setTimeout(
      () => finish(() => reject(new ReadUnavailable('timeout'))),
      REPLACED_READ_WAIT_MS,
    )

    const finish = (settle: () => void) => {
      clearTimeout(deadline)
      clearTimeout(startTimer)
      unsubscribe()
      signal.removeEventListener('abort', abandon)
      settle()
    }

    const abandon = () => finish(() => reject(new ReadAbandoned()))

    const startIfNoneStarted = () => {
      clearTimeout(startTimer)
      startTimer = setTimeout(() => {
        if (!replacing && query.state.fetchStatus === 'idle') {
          // Its outcome arrives as cache events below, like any other replacement's.
          read().catch(() => undefined)
        }
      }, REPLACEMENT_START_MS)
    }

    const onEvent = (event: QueryCacheNotifyEvent) => {
      if (event.query !== query) {
        return
      }
      if (event.type === 'removed') {
        abandon()
        return
      }
      if (event.type !== 'updated') {
        return
      }
      const action = event.action
      switch (action.type) {
        case 'fetch':
          replacing = true
          return
        case 'success':
          // A cache write is not a read.
          if (replacing && action.manual !== true) {
            finish(() => resolve(query.state.data as T))
          }
          return
        case 'error':
          if (isCancelledError(action.error)) {
            replacing = false
            startIfNoneStarted()
          } else if (replacing) {
            finish(() => reject(new ReadUnavailable('failed', action.error)))
          }
          return
        case 'pause':
          if (replacing) {
            finish(() => reject(new ReadUnavailable('paused')))
          }
          return
        case 'setState':
          // Another cancel's revert: keep waiting, under the first deadline.
          if (query.state.fetchStatus === 'idle') {
            replacing = false
            startIfNoneStarted()
          }
          return
        case 'failed':
        case 'continue':
        case 'invalidate':
          return
      }
    }

    const unsubscribe = client.getQueryCache().subscribe(onEvent)
    signal.addEventListener('abort', abandon)
    if (query.state.fetchStatus === 'paused') {
      finish(() => reject(new ReadUnavailable('paused')))
      return
    }
    if (!replacing) {
      startIfNoneStarted()
    }
  })
}
