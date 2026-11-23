import { createContext, useContext, useEffect } from 'react'

/** The reads on the page that are refreshing now; `RefreshSignal` shows progress for them. */
export class RefreshReports {
  readonly #refreshing = new Set<symbol>()
  readonly #listeners = new Set<() => void>()

  report(read: symbol, refreshing: boolean) {
    const was = this.#refreshing.size > 0
    if (refreshing) {
      this.#refreshing.add(read)
    } else {
      this.#refreshing.delete(read)
    }
    if (was !== this.#refreshing.size > 0) {
      for (const listener of this.#listeners) {
        listener()
      }
    }
  }

  anyRefreshing() {
    return this.#refreshing.size > 0
  }

  subscribe(listener: () => void) {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }
}

export const RefreshSignalContext = createContext<RefreshReports | null>(null)

/** Reports a read as refreshing while `refreshing` holds; nothing outside a `RefreshSignal`. */
export function useReportRefreshing(refreshing: boolean) {
  const reports = useContext(RefreshSignalContext)

  // The signal is shared by every read on the page; each report is withdrawn when it ends.
  useEffect(() => {
    if (!reports || !refreshing) {
      return
    }
    const read = Symbol('refreshing-read')
    reports.report(read, true)
    return () => reports.report(read, false)
  }, [reports, refreshing])
}
