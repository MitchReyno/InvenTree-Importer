import { setTimeout as delay } from 'node:timers/promises'
import type { Pool } from 'pg'
import { eq } from 'drizzle-orm'
import { executeDatabaseQuery, queryDatabase } from '#/db/database.ts'
import { processingAttempts } from '#/processing/schema.ts'

/** Poll durable cancellation at a bounded rate; database uncertainty stops new native work. */
export function monitorNativeAttempt(pool: Pool, attemptId: string, shutdown?: AbortSignal) {
  const controller = new AbortController()

  const abort = () => controller.abort()

  shutdown?.addEventListener('abort', abort, { once: true })
  if (shutdown?.aborted) {
    controller.abort()
  }
  const timeout = setTimeout(abort, 5 * 60 * 1000)
  const monitor = (async () => {
    while (!controller.signal.aborted) {
      await delay(500, undefined, { signal: controller.signal }).catch(() => undefined)
      if (controller.signal.aborted) {
        break
      }
      try {
        const attempts = await executeDatabaseQuery(
          queryDatabase(pool)
            .select({ state: processingAttempts.state })
            .from(processingAttempts)
            .where(eq(processingAttempts.id, attemptId)),
        )
        if (attempts[0]?.state !== 'running') {
          controller.abort()
        }
      } catch {
        controller.abort()
      }
    }
  })()
  return {
    controller,
    async stop() {
      clearTimeout(timeout)
      shutdown?.removeEventListener('abort', abort)
      controller.abort()
      await monitor
    },
  }
}
