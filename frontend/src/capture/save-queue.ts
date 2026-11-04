import { classifyFailure, type CommandFailure } from '../operator/command-failure'

export type LaneStatus = 'saved' | 'pending' | 'saving' | 'invalid' | 'rejected'
export type QueueBlock = 'conflict' | 'unconfirmed'

export interface LaneSpec<P, R> {
  send: (payload: P, expectedRevision: string, key: string) => Promise<R>
  /** The batch revision that the acknowledged command produced from the expected revision. */
  revisionOf: (result: R, expectedRevision: string) => string
  onAcknowledged?: (result: R, payload: P) => void
}

export interface QueueState {
  revision: string
  connected: boolean
  blocked: QueueBlock | null
  failure: CommandFailure | null
  /** Anything not yet acknowledged: drafts, invalid input, in-flight or blocked commands. */
  dirty: boolean
  lanes: Record<string, LaneStatus>
}

interface Request<P> {
  lane: string
  payload: P
  revision: string
  key: string
}

interface Lane<P, R> {
  spec: LaneSpec<P, R>
  saved: P
  draft: { payload: P } | null
  invalid: boolean
  ready: boolean
  timer: ReturnType<typeof setTimeout> | undefined
  rejected: { payload: P } | null
}

// Payload builders are deterministic, so serialized equality is structural equality here.
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * One per-batch serialized owner for revision-checked commands. Each request freezes its
 * payload, expected revision and key; later edits wait for that acknowledgement and are sent
 * against the revision it produced. Uncertain outcomes block new commands until the exact
 * request is retried or the queue is explicitly reset; conflicts wait for an explicit rebase.
 */
export class SaveQueue {
  private revision: string
  private readonly debounceMs: number
  private connected = true
  private blocked: QueueBlock | null = null
  private failure: CommandFailure | null = null
  // Lane payload types differ; each lane keeps its own spec and payload together.
  private readonly lanes = new Map<string, Lane<unknown, unknown>>()
  private inflight: Request<unknown> | null = null
  private uncertain: Request<unknown> | null = null
  private readonly listeners = new Set<() => void>()
  private generation = 0
  private suspended = false
  private disposed = false
  private cached: QueueState | null = null

  constructor({ revision, debounceMs = 500 }: { revision: string; debounceMs?: number }) {
    this.revision = revision
    this.debounceMs = debounceMs
  }

  register<P, R>(id: string, spec: LaneSpec<P, R>, saved: P) {
    const existing = this.lanes.get(id)
    if (existing) {
      existing.spec = spec as unknown as LaneSpec<unknown, unknown>
      return
    }
    const lane: Lane<P, R> = {
      spec,
      saved,
      draft: null,
      invalid: false,
      ready: false,
      timer: undefined,
      rejected: null,
    }
    this.lanes.set(id, lane as unknown as Lane<unknown, unknown>)
    this.changed()
  }

  /** Records the latest valid input; it is sent after the idle debounce unless immediate. */
  update<P>(id: string, payload: P, { immediate = false } = {}) {
    const lane = this.lane<P>(id)
    lane.invalid = false
    clearTimeout(lane.timer)
    // While this lane's command is unacknowledged, its saved value may already be stale.
    const matchesSaved =
      same(payload, lane.saved) && !this.isInflight(id) && this.uncertain?.lane !== id
    lane.draft = matchesSaved ? null : { payload }
    lane.ready = false
    if (lane.draft) {
      if (immediate) {
        lane.ready = true
      } else {
        lane.timer = setTimeout(() => {
          lane.ready = true
          this.pump()
        }, this.debounceMs)
      }
    }
    this.changed()
    this.pump()
  }

  /** Invalid input stays dirty and cancels any scheduled send of an earlier valid draft. */
  invalid(id: string) {
    const lane = this.lane(id)
    clearTimeout(lane.timer)
    lane.invalid = true
    lane.ready = false
    this.changed()
  }

  /** Holds every new dispatch (for example during IME composition); drafts keep their readiness. */
  suspend() {
    this.suspended = true
  }

  resume() {
    this.suspended = false
    this.pump()
  }

  /** Adopts a newly observed saved value for a lane with no draft or unacknowledged request. */
  adoptSaved<P>(id: string, saved: P) {
    const lane = this.lanes.get(id)
    if (!lane || lane.draft || lane.invalid || this.isInflight(id) || this.uncertain?.lane === id) {
      return false
    }
    lane.saved = saved
    this.changed()
    return true
  }

  /** Unsent drafts can be discarded locally; anything sent or unconfirmed needs its own recovery. */
  canDiscardLocally() {
    return this.inflight === null && this.blocked === null && this.uncertain === null
  }

  /** Drops every unsent draft, keeping saved values and the revision; needs no server read. */
  discardDrafts() {
    if (!this.canDiscardLocally()) {
      return false
    }
    for (const lane of this.lanes.values()) {
      clearTimeout(lane.timer)
      lane.timer = undefined
      lane.draft = null
      lane.invalid = false
      lane.ready = false
      lane.rejected = null
    }
    this.changed()
    return true
  }

  /** Drops a definitely refused draft that the user chose not to correct, such as a logo file. */
  discard(id: string) {
    const lane = this.lane(id)
    if (this.isInflight(id)) {
      return
    }
    clearTimeout(lane.timer)
    lane.draft = null
    lane.rejected = null
    lane.invalid = false
    lane.ready = false
    this.changed()
  }

  flush(id: string) {
    const lane = this.lane(id)
    if (lane.draft && !lane.invalid) {
      clearTimeout(lane.timer)
      lane.ready = true
      this.pump()
    }
  }

  /** Resends the exact uncertain request: same payload, revision and key. */
  retry() {
    if (
      this.disposed ||
      this.blocked !== 'unconfirmed' ||
      !this.uncertain ||
      this.inflight ||
      !this.connected
    ) {
      return
    }
    const request = this.uncertain
    this.blocked = null
    this.failure = null
    this.dispatch(request)
  }

  /** Explicit human decision to keep local drafts and send them against a newer revision. */
  rebase(revision: string) {
    if (this.inflight) {
      return
    }
    this.revision = revision
    this.blocked = null
    this.failure = null
    this.uncertain = null
    for (const lane of this.lanes.values()) {
      lane.rejected = null
      lane.ready = lane.draft !== null && !lane.invalid
    }
    this.changed()
    this.pump()
  }

  /** Explicit discard: adopt reloaded saved values and drop every local draft and intent. */
  reset(revision: string, saved: Record<string, unknown>) {
    this.generation += 1
    this.inflight = null
    this.uncertain = null
    this.blocked = null
    this.failure = null
    this.revision = revision
    for (const [id, lane] of this.lanes) {
      clearTimeout(lane.timer)
      lane.saved = id in saved ? saved[id] : lane.saved
      lane.draft = null
      lane.invalid = false
      lane.ready = false
      lane.rejected = null
    }
    this.changed()
  }

  setConnected(connected: boolean) {
    if (this.connected === connected) {
      return
    }
    this.connected = connected
    this.changed()
    this.pump()
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  state(): QueueState {
    if (this.cached) {
      return this.cached
    }
    const lanes: Record<string, LaneStatus> = {}
    let dirty = this.inflight !== null || this.blocked !== null
    for (const [id, lane] of this.lanes) {
      lanes[id] = this.status(id, lane)
      dirty ||= lanes[id] !== 'saved'
    }
    this.cached = {
      revision: this.revision,
      connected: this.connected,
      blocked: this.blocked,
      failure: this.failure,
      dirty,
      lanes,
    }
    return this.cached
  }

  /** Re-admits dispatch when an effect replays (StrictMode) after a cleanup disposed the queue. */
  activate() {
    this.disposed = false
    this.pump()
  }

  /** Stops timers and dispatch; an unmounted editor never sends or adopts a late receipt. */
  dispose() {
    this.disposed = true
    this.generation += 1
    for (const lane of this.lanes.values()) {
      clearTimeout(lane.timer)
    }
  }

  private status(id: string, lane: Lane<unknown, unknown>): LaneStatus {
    if (lane.invalid) {
      return 'invalid'
    }
    if (this.isInflight(id)) {
      return 'saving'
    }
    if (lane.rejected && lane.draft && same(lane.rejected.payload, lane.draft.payload)) {
      return 'rejected'
    }
    return lane.draft || this.uncertain?.lane === id ? 'pending' : 'saved'
  }

  private lane<P>(id: string) {
    const lane = this.lanes.get(id)
    if (!lane) {
      throw new Error(`save_queue_lane_unknown:${id}`)
    }
    return lane as Lane<P, unknown>
  }

  private isInflight(id: string) {
    return this.inflight?.lane === id
  }

  private pump() {
    if (this.disposed || this.suspended || this.inflight || this.blocked || !this.connected) {
      return
    }
    for (const [id, lane] of this.lanes) {
      const draft = lane.draft
      if (!draft || !lane.ready || lane.invalid) {
        continue
      }
      if (lane.rejected && same(lane.rejected.payload, draft.payload)) {
        continue
      }
      this.dispatch({
        lane: id,
        payload: draft.payload,
        revision: this.revision,
        key: crypto.randomUUID(),
      })
      return
    }
  }

  private dispatch(request: Request<unknown>) {
    const lane = this.lane(request.lane)
    const generation = this.generation
    this.inflight = request
    this.changed()
    lane.spec.send(request.payload, request.revision, request.key).then(
      (result) => {
        if (generation !== this.generation) {
          return
        }
        this.inflight = null
        this.uncertain = null
        this.revision = lane.spec.revisionOf(result, request.revision)
        lane.saved = request.payload
        lane.rejected = null
        if (lane.draft && same(lane.draft.payload, request.payload)) {
          lane.draft = null
        }
        if (lane.draft) {
          lane.ready = lane.timer === undefined || lane.ready
        }
        lane.spec.onAcknowledged?.(result, request.payload)
        this.changed()
        this.pump()
      },
      (error: unknown) => {
        if (generation !== this.generation) {
          return
        }
        this.inflight = null
        const failure = classifyFailure(error)
        this.failure = failure
        if (failure.kind === 'uncertain') {
          this.uncertain = request
          this.blocked = 'unconfirmed'
        } else if (failure.kind === 'conflict') {
          this.blocked = 'conflict'
          lane.draft ??= { payload: request.payload }
        } else {
          lane.draft ??= { payload: request.payload }
          lane.rejected = { payload: request.payload }
        }
        this.changed()
        this.pump()
      },
    )
  }

  private changed() {
    this.cached = null
    for (const listener of this.listeners) {
      listener()
    }
  }
}
