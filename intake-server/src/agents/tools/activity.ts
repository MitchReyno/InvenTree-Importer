import type { Pool, PoolClient } from 'pg'
import {
  BATCH_ACTIVITY_DEFAULT,
  validate,
  type BatchActivityDto,
  type BatchActivityEntryDto,
} from '@invimport/contracts'
import { transaction } from '#/db/database.ts'
import { captureInTransaction } from '#/capture/repository.ts'
import type { ProcessingConfig } from '#/processing/attempts.ts'
import { jobsWithSessionHistory } from '#/processing/session-history-job.ts'
import { fail } from '#/processing/model.ts'
import { latestStatuses } from './outbox.ts'
import { resolveHistoryEntries, type HistoryJob } from './history-entries.ts'
import {
  INBOX_ORDER_ATTEMPT,
  INBOX_STREAM,
  OUTBOX_STREAM,
  storedHistoryRow,
  type StoredHistoryRow,
} from './history.ts'

/** What an agent did that the app recorded; status lines become the notes, not entries. */
const ACTION_OUTBOX_KINDS = ['observation', 'lot', 'regroup', 'proposal', 'question']
/** The operator's answers, which the feed shows beside what the agents did. */
const ACTION_INBOX_KINDS = ['answer']

/** The batch's jobs whose session history the history route would serve. */
async function sessionJobs(client: PoolClient, config: ProcessingConfig, batchId: string) {
  const rows = await client.query<{
    id: string
    stage: HistoryJob['stage']
    subject_id: string | null
    current_attempt_id: string
  }>(
    `SELECT j.id, j.stage, j.subject_id, j.current_attempt_id
       FROM public.processing_job j
      WHERE j.batch_id=$1`,
    [batchId],
  )
  const withHistory = await jobsWithSessionHistory(
    client,
    config,
    batchId,
    rows.rows.map((row) => row.id),
  )
  const sessionRows = rows.rows.filter((row) => withHistory.has(row.id))
  return new Map(
    sessionRows.map((row): [string, HistoryJob] => [
      row.id,
      {
        id: row.id,
        batchId,
        stage: row.stage,
        subjectId: row.subject_id,
        currentAttemptId: row.current_attempt_id,
      },
    ]),
  )
}

async function inboxCursors(client: PoolClient, jobIds: readonly string[]) {
  const rows = await client.query<{ session_lineage_id: string; acked_seq: string }>(
    `SELECT session_lineage_id, acked_seq::text FROM public.agent_session_cursor
      WHERE session_lineage_id = ANY($1::uuid[])`,
    [[...jobIds]],
  )
  return new Map(rows.rows.map((row) => [row.session_lineage_id, BigInt(row.acked_seq)]))
}

/** The newest action rows across the jobs, in the history's total order with the job between. */
async function actionRows(client: PoolClient, jobIds: readonly string[], limit: number) {
  const rows = await client.query<StoredHistoryRow & { job_id: string }>(
    `SELECT h.job_id, h.stream, h.attempt_id, h.attempt_number, h.seq::text, h.kind, h.payload,
            h.created_at, h.item_id, h.actor_id, h.idempotency_key
       FROM (
         SELECT a.job_id, ${OUTBOX_STREAM} AS stream, o.session_id AS attempt_id,
                o.session_id AS order_attempt, a.number::text AS attempt_number, o.seq, o.kind,
                o.payload, o.created_at, NULL::uuid AS item_id, NULL::uuid AS actor_id,
                NULL::text AS idempotency_key
           FROM public.agent_session_outbox o
           JOIN public.agent_session s ON s.attempt_id=o.session_id
           JOIN public.processing_attempt a ON a.id=o.session_id
          WHERE a.job_id = ANY($1::uuid[]) AND s.session_lineage_id=a.job_id
            AND o.kind = ANY($2::text[])
         UNION ALL
         SELECT i.session_lineage_id, ${INBOX_STREAM}, NULL, '${INBOX_ORDER_ATTEMPT}'::uuid, NULL,
                i.seq, i.kind, i.payload, i.created_at, i.id, i.actor_id, i.idempotency_key
           FROM public.agent_session_inbox i
          WHERE i.session_lineage_id = ANY($1::uuid[]) AND i.kind = ANY($3::text[])
       ) h
      ORDER BY h.created_at DESC, h.stream DESC, h.job_id DESC, h.order_attempt DESC, h.seq DESC
      LIMIT $4`,
    [[...jobIds], ACTION_OUTBOX_KINDS, ACTION_INBOX_KINDS, limit],
  )
  return rows.rows.map((row) => storedHistoryRow(row, row.job_id))
}

/**
 * The batch's newest recorded actions across every session job, newest first, each resolved as
 * its job's history resolves it and followed by the job's latest status line as the agent's note.
 * One repeatable-read snapshot, scoped to the caller's account; one query per entry kind.
 */
export async function readBatchActivity(
  pool: Pool,
  config: ProcessingConfig,
  batchId: string,
  limit = BATCH_ACTIVITY_DEFAULT,
): Promise<BatchActivityDto> {
  return transaction(pool, async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const { snapshot } = await captureInTransaction(client, config, batchId)
    const jobs = await sessionJobs(client, config, batchId)
    const jobIds = [...jobs.keys()]
    const rows = jobIds.length ? await actionRows(client, jobIds, limit) : []
    const context = {
      batchId,
      jobs,
      capture: snapshot,
      ackedSeq: await inboxCursors(client, jobIds),
    }
    const entries = await resolveHistoryEntries(client, context, rows)
    const statuses = await latestStatuses(
      client,
      [...jobs.values()].map((job) => job.currentAttemptId),
    )
    // A history places web reads after their proposal; the feed has the proposal alone, so the
    // remaining entries are the rows', one for one and in order.
    const actions = entries.filter((entry) => entry.details.kind !== 'web_read')
    if (actions.length !== rows.length) {
      return fail('batch_activity_rows_mismatch')
    }
    const activity: BatchActivityDto = {
      entries: actions.map((entry, index): BatchActivityEntryDto => {
        const job = jobs.get(rows[index].jobId)!
        return {
          job_id: job.id,
          stage: job.stage,
          subject_id: job.subjectId,
          entry,
          agent_note: statuses.get(job.currentAttemptId) ?? null,
        }
      }),
    }
    validate('BatchActivity', activity)
    return activity
  })
}
