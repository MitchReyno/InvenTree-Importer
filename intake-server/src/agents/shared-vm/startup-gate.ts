/** Lets one turn start at a time; ends its own hold once a release is due, so none blocks others. */
export class StartupGate {
  private held = false
  private readonly waiting: (() => void)[] = []

  /** `holdMs` bounds one turn's start, after which the next may begin. */
  constructor(private readonly holdMs: number) {}

  /**
   * Waits, in order, until this caller may start. Resolves its release, which may be called more
   * than once, or undefined when `waitMs` passes first. Rejects with the signal's reason on abort.
   */
  async enter(signal: AbortSignal, waitMs: number): Promise<(() => void) | undefined> {
    signal.throwIfAborted()
    if (!this.held) {
      this.held = true
      return this.holdFor()
    }
    const admitted = await new Promise<boolean>((resolve, reject) => {
      const wake = () => {
        cleanup()
        resolve(true)
      }

      const leave = () => {
        const index = this.waiting.indexOf(wake)
        if (index >= 0) {
          this.waiting.splice(index, 1)
        }
      }

      const timer = setTimeout(() => {
        leave()
        cleanup()
        resolve(false)
      }, waitMs)

      const abort = () => {
        leave()
        cleanup()
        reject(signal.reason)
      }

      const cleanup = () => {
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
      }

      signal.addEventListener('abort', abort, { once: true })
      this.waiting.push(wake)
    })
    // A release that wakes a waiter hands it the gate, so it stays held between them.
    return admitted ? this.holdFor() : undefined
  }

  private holdFor() {
    let released = false

    const release = () => {
      if (released) {
        return
      }
      released = true
      clearTimeout(bound)
      const next = this.waiting.shift()
      if (next) {
        next()
      } else {
        this.held = false
      }
    }

    const bound = setTimeout(release, this.holdMs)
    bound.unref()
    return release
  }
}
