import type { PoolClient } from 'pg'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { executeDatabaseQuery, queryDatabase } from '#/db/database.ts'
import { agentSessions } from '#/agents/schema.ts'
import { processingAttempts, processingJobs, processingProposalStale } from './schema.ts'
import { SUCCESSOR_STAGES, supersedeJobAttempts } from './supersede.ts'

/**
 * A lot's observation set changed. Caller holds the capture lock. Research and Images attempts
 * that have not started are superseded, and identities relying on the lot's observation set become
 * stale; the next stable identity queues fresh attempts. Running sessions keep running.
 */
export async function lotRegrouped(client: PoolClient, lotId: string) {
  // Deployments without Processing grant capture roles nothing on its tables.
  const visible = await client.query<{ visible: boolean }>(
    "SELECT has_table_privilege('public.processing_job', 'SELECT') AS visible",
  )
  if (visible.rows[0]?.visible !== true) {
    return { superseded: [] as string[], stale: [] as string[] }
  }
  const db = queryDatabase(client)
  const jobs = await executeDatabaseQuery(
    db
      .select({ id: processingJobs.id })
      .from(processingJobs)
      .innerJoin(processingAttempts, eq(processingAttempts.id, processingJobs.currentAttemptId))
      .innerJoin(agentSessions, eq(agentSessions.attemptId, processingAttempts.id))
      .where(
        and(
          eq(processingJobs.subjectId, lotId),
          inArray(processingJobs.stage, [...SUCCESSOR_STAGES]),
          eq(processingAttempts.state, 'queued'),
          eq(agentSessions.sessionState, 'queued'),
        ),
      )
      .for('update', { of: processingJobs }),
  )
  for (const job of jobs) {
    await supersedeJobAttempts(client, job.id)
    await executeDatabaseQuery(
      db
        .update(processingJobs)
        .set({ state: 'superseded', revision: sql`${processingJobs.revision}+1` })
        .where(eq(processingJobs.id, job.id)),
    )
  }
  const relying = await client.query<{ id: string }>(
    `SELECT p.id FROM public.processing_proposal p
     JOIN public.processing_attempt a ON a.id=p.attempt_id
     JOIN public.processing_job j ON j.id=a.job_id
     WHERE j.batch_id=(SELECT l.batch_id FROM public.capture_lot l WHERE l.id=$1)
       AND p.relies_on->'sources' @> jsonb_build_array(jsonb_build_object('kind','observation_set','lot_id',$1::text))
       AND NOT EXISTS (SELECT 1 FROM public.processing_proposal_stale s WHERE s.proposal_id=p.id)`,
    [lotId],
  )
  if (relying.rows.length) {
    await executeDatabaseQuery(
      db
        .insert(processingProposalStale)
        .values(
          relying.rows.map((row) => ({ proposalId: row.id, reason: 'lot_regrouped' as const })),
        )
        .onConflictDoNothing(),
    )
  }
  return { superseded: jobs.map((job) => job.id), stale: relying.rows.map((row) => row.id) }
}
