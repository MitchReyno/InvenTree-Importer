import type { Pool } from 'pg'
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
  config: Pick<ProcessingConfig, 'actorId' | 'targetId' | 'targetContextId'>,
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
    // The latest version of each instruction: the whole batch's and each evidence group's.
    const instructions = await executeDatabaseQuery(
      db
        .selectDistinctOn([captureInstructions.groupId], {
          id: captureInstructions.id,
          groupId: captureInstructions.groupId,
          text: captureInstructions.text,
          actorId: captureInstructions.actorId,
        })
        .from(captureInstructions)
        .where(eq(captureInstructions.batchId, batchId))
        .orderBy(
          asc(captureInstructions.groupId),
          desc(captureInstructions.version),
          desc(captureInstructions.createdAt),
        ),
    )
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
      for (const instruction of instructions) {
        await appendSessionInbox(
          client,
          {
            binding: config,
            batchId,
            lineageId: session.lineageId!,
            actorId: instruction.actorId,
            idempotencyKey: `instruction:${instruction.id}`,
            kind: 'instruction',
            payload: { text: instruction.text, group_id: instruction.groupId },
          },
          { publish: false },
        )
      }
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
