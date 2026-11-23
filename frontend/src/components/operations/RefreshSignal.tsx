import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { RefreshReports, RefreshSignalContext } from '#/context'
import { RefreshLine } from '#/components/ui'

/** A refresh shorter than this shows nothing. */
export const REFRESH_LINE_DELAY_MS = 400
/** A refresh longer than this also says "Updating…". */
export const REFRESH_STATUS_DELAY_MS = 3000

type Stage = 'quiet' | 'line' | 'status'

/** Collects the page's refreshing reads and shows their progress without moving the page. */
export function RefreshSignal({ children }: { children: ReactNode }) {
  const [reports] = useState(() => new RefreshReports())
  const refreshing = useSyncExternalStore(
    (listener) => reports.subscribe(listener),
    () => reports.anyRefreshing(),
  )
  const [stage, setStage] = useState<Stage>('quiet')
  const shown: Stage = refreshing ? stage : 'quiet'

  // The delays are timers, kept while any read refreshes and cleared once none does.
  useEffect(() => {
    if (!refreshing) {
      return
    }
    const line = setTimeout(() => setStage('line'), REFRESH_LINE_DELAY_MS)
    const status = setTimeout(() => setStage('status'), REFRESH_STATUS_DELAY_MS)
    return () => {
      clearTimeout(line)
      clearTimeout(status)
      setStage('quiet')
    }
  }, [refreshing])

  return (
    <RefreshSignalContext.Provider value={reports}>
      <RefreshLine line={shown !== 'quiet'} status={shown === 'status'} />
      {children}
    </RefreshSignalContext.Provider>
  )
}
