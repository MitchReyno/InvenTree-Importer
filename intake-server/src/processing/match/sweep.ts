import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import type { MatchReader } from '#/inventory/match-reads.ts'
import { matchSearch } from './search.ts'
import type { ProcessingConfig } from '#/processing/attempts.ts'
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
  let failing = false
  let running: Promise<void> | undefined

  const tick = () => {
    if (stopped || running) {
      return
    }
    running = settlePendingSearches(pool, config, search)
      .then(() => {
        failing = false
      })
      .catch(() => {
        // Reported when sweeps start failing, not on every retry.
        if (!failing) {
          report('match_sweep_failed')
        }
        failing = true
      })
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

/**
 * Runs the sweep for the life of an API server: started once it is ready, stopped before it
 * closes. Without a reader every InvenTree read is unavailable; import references still settle.
 */
export function registerMatchSweep(
  server: FastifyInstance,
  pool: Pool,
  config: ProcessingConfig,
  reader: MatchReader | undefined,
  report: (event: string) => void,
) {
  let sweep: ReturnType<typeof startMatchSweep> | undefined
  server.addHook('onReady', async () => {
    sweep = startMatchSweep(pool, config, matchSearch(pool, config, reader), report)
  })
  server.addHook('preClose', async () => sweep?.stop())
}
