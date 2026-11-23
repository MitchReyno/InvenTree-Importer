/**
 * How a save ended for the queue: `done` lets the next save run; `hold` pauses the queue
 * because what is saved is unknown or contested, until its owner releases it.
 */
export type SaveResult = 'done' | 'hold'

/** One subsection's save. It builds its request when it starts, never when it was queued. */
export type SaveJob = () => Promise<SaveResult>

export type SaveQueueSnapshot = {
  /** A save is being sent. */
  running: boolean
  /** An outcome is unknown or contested, so later saves wait. */
  held: boolean
}

type Waiting = {
  owner: string
  job: SaveJob
  resolving: boolean
  settled: Promise<SaveResult>
  resolve: (result: SaveResult) => void
}

/**
 * Settings › Agents saves, one at a time: every subsection writes the same settings under one
 * revision, so two saves in flight would refuse each other. Owns each subsection's debounce, so
 * leaving the page can send them all at once.
 */
export function createSaveQueue() {
  const waiting: Waiting[] = []
  const held = new Set<string>()
  const timers = new Map<string, { timer: ReturnType<typeof setTimeout>; job: SaveJob }>()
  const listeners = new Set<() => void>()
  const quiet: (() => void)[] = []
  let running = false
  let snapshot: SaveQueueSnapshot = { running: false, held: false }

  function publish() {
    const next = { running, held: held.size > 0 }
    if (next.running !== snapshot.running || next.held !== snapshot.held) {
      snapshot = next
      listeners.forEach((listener) => listener())
    }
  }

  /** The next job allowed to run: any while nothing is held, otherwise only a resolution. */
  function nextRunnable() {
    if (held.size === 0) {
      return waiting.length > 0 ? 0 : -1
    }
    return waiting.findIndex((entry) => entry.resolving && held.has(entry.owner))
  }

  function pump() {
    if (running) {
      return
    }
    const index = nextRunnable()
    if (index < 0) {
      quiet.splice(0).forEach((resolve) => resolve())
      publish()
      return
    }
    const [entry] = waiting.splice(index, 1)
    running = true
    publish()
    void entry
      .job()
      .catch((): SaveResult => 'hold')
      .then((result) => {
        if (result === 'hold') {
          held.add(entry.owner)
        }
        running = false
        entry.resolve(result)
        pump()
      })
  }

  function run(owner: string, job: SaveJob, options: { resolving?: boolean } = {}) {
    const resolving = options.resolving ?? false
    // A queued save builds its request when it starts, so one waiting save covers every edit.
    const queued = waiting.find((entry) => entry.owner === owner && entry.resolving === resolving)
    if (queued) {
      queued.job = job
      return queued.settled
    }

    let resolve: (result: SaveResult) => void = () => {}

    const settled = new Promise<SaveResult>((done) => {
      resolve = done
    })
    waiting.push({ owner, job, resolving, settled, resolve })
    pump()
    return settled
  }

  function cancelTimer(owner: string) {
    const scheduled = timers.get(owner)
    if (scheduled) {
      clearTimeout(scheduled.timer)
      timers.delete(owner)
    }
  }

  return {
    run,

    /**
     * Runs `owner`'s save after `delayMs` of quiet; each call restarts the wait, including for a
     * save already queued behind another, which waits for the new pause.
     */
    schedule(owner: string, job: SaveJob, delayMs: number) {
      cancelTimer(owner)
      const queued = waiting.findIndex((entry) => entry.owner === owner && !entry.resolving)
      if (queued >= 0) {
        const [entry] = waiting.splice(queued, 1)
        entry.resolve('done')
      }
      const timer = setTimeout(() => {
        timers.delete(owner)
        void run(owner, job)
      }, delayMs)
      timers.set(owner, { timer, job })
    },

    /** Forgets a scheduled save that hasn't been queued yet. */
    cancel: cancelTimer,

    /** Whether `owner` has a save scheduled or waiting to run. */
    pending(owner: string) {
      return timers.has(owner) || waiting.some((entry) => entry.owner === owner)
    },

    /** `owner`'s outcome is known again; saves held behind it may run. */
    release(owner: string) {
      held.delete(owner)
      pump()
    },

    /**
     * Queues every scheduled save now, and resolves once nothing more can run: the queue is
     * empty, or only saves held behind an unknown or contested outcome are left.
     */
    flush() {
      for (const [owner, { job }] of [...timers]) {
        cancelTimer(owner)
        void run(owner, job)
      }
      return new Promise<void>((resolve) => {
        quiet.push(resolve)
        pump()
      })
    },

    /** Drops scheduled saves when the page leaves; a remount schedules afresh. */
    dispose() {
      for (const owner of [...timers.keys()]) {
        cancelTimer(owner)
      }
    },

    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    snapshot: () => snapshot,
  }
}

export type SaveQueue = ReturnType<typeof createSaveQueue>
