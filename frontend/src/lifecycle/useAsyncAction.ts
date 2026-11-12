import { useCallback, useRef, useState } from 'react'

/** How a call to `run` ended: `skipped` means another action was still running. */
export type AsyncActionOutcome = 'succeeded' | 'failed' | 'skipped'

export interface AsyncAction {
  /** True while an action started by `run` has not settled. */
  busy: boolean
  /** The failure text of the last run that threw, until the next run that starts, or `clearError`. */
  error: string
  run: (action: () => Promise<unknown>, failureText: string) => Promise<AsyncActionOutcome>
  clearError: () => void
}

/**
 * The busy flag and failure text around one plain async action, such as a button that sends a
 * request. It keeps no payload or key; a payload-bound retry keeps its key elsewhere, such as in
 * `useRetainedCommand` or `processing/pending-messages`.
 * Every throw shows the same failure text, so an action that must tell a conflict, refusal or
 * uncertain outcome apart needs its own handling.
 */
export function useAsyncAction(): AsyncAction {
  // A ref, not `busy`, so a second call before the next render still sees the first.
  const running = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const run = useCallback(
    async (action: () => Promise<unknown>, failureText: string): Promise<AsyncActionOutcome> => {
      if (running.current) {
        return 'skipped'
      }

      running.current = true
      setBusy(true)
      setError('')

      try {
        await action()
        return 'succeeded'
      } catch {
        setError(failureText)
        return 'failed'
      } finally {
        running.current = false
        setBusy(false)
      }
    },
    [],
  )

  const clearError = useCallback(() => setError(''), [])

  return { busy, error, run, clearError }
}
