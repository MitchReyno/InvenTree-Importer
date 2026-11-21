import type { PoolClient } from 'pg'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { executeDatabaseQuery, queryDatabase } from '#/db/database.ts'
import { processingAttempts, processingQuestions } from './schema.ts'

/** The per-lot sessions a stable identity starts, in parallel. Inventory waits for both. */
export const SUCCESSOR_STAGES = ['research', 'images'] as const

/** Caller holds the actor lane and selected job lock before invalidating attempts/questions. */
export async function supersedeJobAttempts(client: PoolClient, jobId: string) {
  await executeDatabaseQuery(
    queryDatabase(client)
      .update(processingAttempts)
      .set({ state: 'superseded' })
      .where(
        and(
          eq(processingAttempts.jobId, jobId),
          inArray(processingAttempts.state, [
            'queued',
            'running',
            'waiting_for_user',
            'waiting_for_login',
            'waiting_for_capacity',
            'interrupted',
          ]),
        ),
      ),
  )
  await executeDatabaseQuery(
    queryDatabase(client)
      .update(processingQuestions)
      .set({ state: 'superseded', revision: sql`${processingQuestions.revision}+1` })
      .where(and(eq(processingQuestions.jobId, jobId), eq(processingQuestions.state, 'open'))),
  )
  // Logical supersession does not prove that a held worker command ended.
}
