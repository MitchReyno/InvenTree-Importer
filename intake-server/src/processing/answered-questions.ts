import type { PoolClient } from 'pg'
import type { AnswerDeliveryDto, ProcessingJobDto } from '@invimport/contracts'
import type { ProcessingConfig } from './attempts.ts'
import {
  answerEffects,
  answeredValues,
  compactAnswerSummary,
  decodeStoredAnswer,
  fullAnswerSummary,
  type BudgetedAnswer,
} from './answer-summary.ts'
import { jobsWithSessionHistory } from './session-history-job.ts'

interface StoredAnswerRow {
  id: string
  question_id: string
  value_bytes: Buffer
  created_at: Date
}

interface DeliveryRow {
  question_id: string
  seq: string
  acked_seq: string | null
  acked_at: Date | null
}

/** Each answered question's answer, one per question, in one query for the batch's jobs. */
async function storedAnswers(client: PoolClient, jobIds: readonly string[]) {
  const rows = await client.query<StoredAnswerRow>(
    `SELECT a.id, a.question_id, a.value_bytes, a.created_at
       FROM public.processing_answer a
      WHERE a.job_id=ANY($1::uuid[])`,
    [[...jobIds]],
  )
  return new Map(rows.rows.map((row) => [row.question_id, row]))
}

/**
 * Each session answer's inbox item, by its `answer:<question>` key, with the lineage's cursor and
 * the logged advance that first acknowledged it. An earlier runner answer has no item.
 */
async function answerDeliveries(client: PoolClient, jobIds: readonly string[]) {
  const rows = await client.query<DeliveryRow>(
    `SELECT substr(i.idempotency_key, 8) AS question_id, i.seq::text,
            c.acked_seq::text, k.acked_at
       FROM public.agent_session_inbox i
       LEFT JOIN public.agent_session_cursor c ON c.session_lineage_id=i.session_lineage_id
       LEFT JOIN public.agent_session_ack k ON k.session_lineage_id=i.session_lineage_id
            AND k.from_seq < i.seq AND i.seq <= k.to_seq
      WHERE i.session_lineage_id=ANY($1::uuid[]) AND i.kind='answer'
        AND i.idempotency_key LIKE 'answer:%'`,
    [[...jobIds]],
  )
  const deliveries = new Map<string, AnswerDeliveryDto>()
  for (const row of rows.rows) {
    const read = row.acked_seq !== null && BigInt(row.seq) <= BigInt(row.acked_seq)
    deliveries.set(row.question_id, {
      state: read ? 'read' : 'waiting',
      read_at: read && row.acked_at ? row.acked_at.toISOString() : null,
    })
  }
  return deliveries
}

async function replacements(client: PoolClient, jobIds: readonly string[]) {
  const rows = await client.query<{ question_id: string; replaced_by: string }>(
    `SELECT question_id, replaced_by FROM public.processing_question_replacement
      WHERE job_id=ANY($1::uuid[])`,
    [[...jobIds]],
  )
  return new Map(rows.rows.map((row) => [row.question_id, row.replaced_by]))
}

/**
 * Marks every question with its job's session-history flag and any replacement, and returns each
 * answered question's full and compact answer members for the caller to budget.
 */
export async function answeredQuestionFacts(
  client: PoolClient,
  config: ProcessingConfig,
  batchId: string,
  jobs: readonly ProcessingJobDto[],
): Promise<BudgetedAnswer[]> {
  const jobIds = jobs.map((job) => job.id)
  const withHistory = await jobsWithSessionHistory(client, config, batchId, jobIds)
  const replacedBy = await replacements(client, jobIds)
  const answers = await storedAnswers(client, jobIds)
  const deliveries = await answerDeliveries(client, jobIds)
  const budgeted: BudgetedAnswer[] = []
  for (const job of jobs) {
    for (const question of job.questions) {
      question.session_history = withHistory.has(job.id)
      const replacement = replacedBy.get(question.id)
      if (replacement) {
        question.replaced_by = replacement
      }
      const stored = answers.get(question.id)
      if (question.state !== 'answered' || !stored) {
        continue
      }
      const values = answeredValues(question, decodeStoredAnswer(stored.value_bytes))
      const delivery = deliveries.get(question.id)
      const input = {
        answerId: stored.id,
        answeredAt: stored.created_at.toISOString(),
        values,
        effects: answerEffects(
          values.map((value) => value.value),
          job.subject_id ?? question.subject_id,
        ),
        ...(delivery ? { delivery } : {}),
      }
      budgeted.push({
        question,
        full: fullAnswerSummary(input),
        compact: compactAnswerSummary(input),
        answeredAt: input.answeredAt,
      })
    }
  }
  return budgeted
}
