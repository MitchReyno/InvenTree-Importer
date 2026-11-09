import type { Pool, PoolClient } from 'pg'
import { and, asc, desc, eq, isNotNull, notInArray } from 'drizzle-orm'
import type { InstructionDeliveryDto } from '@invimport/contracts'
import { executeDatabaseQuery, queryDatabase, transaction } from '../db/database.ts'
import { appendEvent } from '../db/authority.ts'
import { captureBatches, captureInstructions } from '../capture/schema.ts'
import type { ProcessingConfig } from '../processing/attempts.ts'
import { fail } from '../processing/model.ts'
import { processingAttempts, processingJobs } from '../processing/schema.ts'
import { agentSessions } from './schema.ts'
import { appendSessionInbox } from './tools/inbox.ts'

/** Sessions that are over and will not read their inbox again. */
const ENDED = ['cancelling', 'cancelled', 'failed'] as const
/** Sessions the wake sweep resumes when an unread inbox item arrives. */
const WOKEN = new Set(['waiting_input', 'finished', 'interrupted'])

/**
 * Sends the batch's current instructions to each of its sessions' inboxes, once per saved version.
 * A running session reads them as it works, a queued one when it starts, and a waiting or finished
 * one is woken by the wake sweep to apply them. It runs after the instruction is saved, so a
 * failed delivery never undoes the instruction.
 */
export async function deliverInstructions(
  pool: Pool,
  config: Binding,
  batchId: string,
): Promise<InstructionDeliveryDto> {
  return transaction(pool, async (client) => {
    const db = queryDatabase(client)
    const batch = (
      await executeDatabaseQuery(
        db
          .select({ streamId: captureBatches.streamId, archived: captureBatches.archived })
          .from(captureBatches)
          .where(
            and(
              eq(captureBatches.id, batchId),
              eq(captureBatches.actorId, config.actorId),
              eq(captureBatches.targetId, config.targetId),
              eq(captureBatches.targetContextId, config.targetContextId),
            ),
          )
          .for('share'),
      )
    )[0]
    if (!batch) {
      fail('not_found', 404)
    }
    if (batch.archived) {
      fail('batch_archived', 409)
    }
    const instructions = await currentInstructions(client, batchId)
    // Each job's current session, unless it is over.
    const sessions = await executeDatabaseQuery(
      db
        .select({ lineageId: agentSessions.sessionLineageId, state: agentSessions.sessionState })
        .from(agentSessions)
        .innerJoin(processingAttempts, eq(processingAttempts.id, agentSessions.attemptId))
        .innerJoin(processingJobs, eq(processingJobs.currentAttemptId, processingAttempts.id))
        .where(
          and(
            eq(processingAttempts.batchId, batchId),
            isNotNull(agentSessions.sessionLineageId),
            notInArray(agentSessions.sessionState, [...ENDED]),
          ),
        )
        .orderBy(asc(agentSessions.sessionLineageId)),
    )
    for (const session of sessions) {
      await appendInstructions(client, config, batchId, session.lineageId!, instructions)
    }
    if (sessions.length && instructions.length) {
      await appendEvent(client, batch.streamId, 'session_inbox_changed', { batch_id: batchId })
    }
    return {
      sessions: sessions.length,
      woken: sessions.filter((session) => session.state !== null && WOKEN.has(session.state))
        .length,
    }
  })
}

type Binding = Pick<ProcessingConfig, 'actorId' | 'targetId' | 'targetContextId'>

/** The latest version of each instruction: the whole batch's and each evidence group's. */
async function currentInstructions(client: PoolClient, batchId: string) {
  return executeDatabaseQuery(
    queryDatabase(client)
      .selectDistinctOn([captureInstructions.groupId], {
        id: captureInstructions.id,
        groupId: captureInstructions.groupId,
        text: captureInstructions.text,
      })
      .from(captureInstructions)
      .where(eq(captureInstructions.batchId, batchId))
      .orderBy(
        asc(captureInstructions.groupId),
        desc(captureInstructions.version),
        desc(captureInstructions.createdAt),
      ),
  )
}

async function appendInstructions(
  client: PoolClient,
  binding: Binding,
  batchId: string,
  lineageId: string,
  instructions: Awaited<ReturnType<typeof currentInstructions>>,
  attemptId?: string,
) {
  for (const instruction of instructions) {
    await appendSessionInbox(
      client,
      {
        binding,
        batchId,
        lineageId,
        // Relayed as a system notice, so the runner can give it to a session it starts.
        actorId: null,
        idempotencyKey: attemptId
          ? `instruction:${instruction.id}:${attemptId}`
          : `instruction:${instruction.id}`,
        kind: 'instruction',
        payload: { instruction_id: instruction.id, text: instruction.text, group_id: instruction.groupId },
      },
      { publish: false },
    )
  }
}

/**
 * Gives a session the saved instructions in the transaction that creates its job or attempt, so it
 * reads them from its inbox at the start. A restarted or replaced attempt starts a new conversation
 * past the lineage's read cursor, so it gets its own copies, keyed by the attempt.
 */
export async function instructNewSession(
  client: PoolClient,
  binding: Binding,
  batchId: string,
  lineageId: string,
  restartedAttemptId?: string,
) {
  await appendInstructions(
    client,
    binding,
    batchId,
    lineageId,
    await currentInstructions(client, batchId),
    restartedAttemptId,
  )
}

/** How many missing instruction items one supervisor pass relays at most. */
const MAX_RELAYS_PER_PASS = 200

/**
 * Relays each live session's missing latest instructions, so an instruction saved while delivery
 * failed, such as Capture's autosave going out while the database was briefly unavailable,
 * still reaches the agents. The supervisor runs it every pass, before the wake sweep.
 */
export async function deliverMissingInstructions(pool: Pool, config: Binding) {
  return transaction(pool, async (client) => {
    // Lock the batches first, in id order like Pause all, so the latest instruction read below
    // cannot be overtaken by a save, and the two never wait on each other.
    const candidates = await client.query<{ id: string }>(
      `SELECT DISTINCT b.id FROM capture_batch b
         JOIN capture_instruction i ON i.batch_id=b.id
        WHERE b.actor_id=$1 AND b.target_id=$2 AND b.target_context_id=$3 AND NOT b.archived
        ORDER BY b.id`,
      [config.actorId, config.targetId, config.targetContextId],
    )
    if (!candidates.rows.length) {
      return 0
    }
    const locked = await client.query<{ id: string }>(
      `SELECT id FROM capture_batch WHERE id = ANY($1::uuid[]) AND NOT archived ORDER BY id FOR SHARE`,
      [candidates.rows.map((row) => row.id)],
    )
    const missing = await client.query<{
      lineage_id: string
      batch_id: string
      stream_id: string
      id: string
      group_id: string | null
      text: string
    }>(
      `WITH latest AS (
         SELECT DISTINCT ON (i.batch_id, i.group_id) i.id, i.batch_id, i.group_id, i.text, b.stream_id
           FROM capture_instruction i JOIN capture_batch b ON b.id=i.batch_id
          WHERE b.id = ANY($1::uuid[])
          ORDER BY i.batch_id, i.group_id, i.version DESC, i.created_at DESC
       ), live AS (
         SELECT s.session_lineage_id AS lineage_id, a.batch_id
           FROM agent_session s
           JOIN processing_attempt a ON a.id=s.attempt_id
           JOIN processing_job j ON j.current_attempt_id=a.id
          WHERE s.session_lineage_id IS NOT NULL
            AND s.session_state NOT IN ('cancelling','cancelled','failed')
       )
       SELECT live.lineage_id, live.batch_id, latest.stream_id, latest.id, latest.group_id, latest.text
         FROM live JOIN latest ON latest.batch_id=live.batch_id
        WHERE NOT EXISTS (
          SELECT 1 FROM agent_session_inbox x
           WHERE x.session_lineage_id=live.lineage_id
             AND x.idempotency_key LIKE 'instruction:' || latest.id::text || '%')
        ORDER BY live.batch_id, live.lineage_id, latest.id
        LIMIT $2`,
      [locked.rows.map((row) => row.id), MAX_RELAYS_PER_PASS],
    )
    const streams = new Map<string, string>()
    for (const row of missing.rows) {
      await appendInstructions(client, config, row.batch_id, row.lineage_id, [
        { id: row.id, groupId: row.group_id, text: row.text },
      ])
      streams.set(row.batch_id, row.stream_id)
    }
    for (const [batchId, streamId] of streams) {
      await appendEvent(client, streamId, 'session_inbox_changed', { batch_id: batchId })
    }
    return missing.rows.length
  })
}
