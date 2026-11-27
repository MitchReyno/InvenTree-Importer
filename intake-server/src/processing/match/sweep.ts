import type { Pool } from 'pg'
import type { ProcessingConfig } from '../attempts.ts'
import { settlePendingSearches, type MatchSearch } from './settle.ts'

/** How often the API looks for committed search requests to run. */
export const MATCH_SWEEP_INTERVAL_MS = 1000

/**
 * The API process's durable sweep over committed, unsettled search requests. One sweep runs at a
 * time; a failed one is reported by a fixed event and the next interval tries again, so a request
 * committed before a restart or a failure still settles.
 */
export function startMatchSweep(
  pool: Pool,
  config: ProcessingConfig,
  search: MatchSearch,
  report: (event: string) => void,
  intervalMs = MATCH_SWEEP_INTERVAL_MS,
) {
  let stopped = false
  let running: Promise<void> | undefined

  const tick = () => {
    if (stopped || running) {
      return
    }
    running = settlePendingSearches(pool, config, search)
      .then(() => undefined)
      .catch(() => report('match_sweep_failed'))
      .finally(() => {
        running = undefined
      })
  }

  const timer = setInterval(tick, intervalMs)
  tick()
  return {
    async stop() {
      stopped = true
      clearInterval(timer)
      await running
    },
  }
}
