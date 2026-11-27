import {
  and,
  asc,
  eq,
  isNotNull,
  isNull,
  lt,
  ne,
  notExists,
  notInArray,
  or,
  sql,
} from 'drizzle-orm'
import type { Pool, PoolClient } from 'pg'
import { executeDatabaseQuery, queryDatabase, transaction } from '#/db/database.ts'
import { commands } from '#/db/schema.ts'
import { captureBatches } from '#/capture/schema.ts'
import type { ProcessingConfig } from '#/processing/attempts.ts'
import { processingAttempts, processingJobs, processingLanes } from '#/processing/schema.ts'
import { agentBatchPauses, agentSessions, agentSettings, agentSlots } from '#/agents/schema.ts'
import { DEFAULT_SESSION_CONCURRENCY } from '#/agents/settings.ts'
import { requireSupervisorFence, type SupervisorFence } from '#/agents/supervisor-fence.ts'

export const MAX_SESSION_SLOTS = 8

async function sessionLimit(client: PoolClient, config: ProcessingConfig) {
  const rows = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ limit: agentSettings.sessionConcurrency })
      .from(agentSettings)
      .where(
        and(
          eq(agentSettings.actorId, config.actorId),
          eq(agentSettings.targetId, config.targetId),
          eq(agentSettings.targetContextId, config.targetContextId),
        ),
      ),
  )
  return rows[0]?.limit ?? DEFAULT_SESSION_CONCURRENCY
}

/**
 * Claims a slot for a queued session, or returns false to keep it queued. Claims for one actor
 * are serialized, the limit is read on each claim, a `/1` lane holder counts as one slot, and
 * queued sessions start oldest first, Examine lead sessions before per-lot ones. No session
 * waits behind a queued Inventory, which may be held at its gate. Lowering the limit only stops
 * new claims. `vmCapacity`, the turns the agent VM holds, lowers the limit for VM sessions.
 */
export async function claimSessionSlot(
  client: PoolClient,
  config: ProcessingConfig,
  attemptId: string,
  vmCapacity?: number,
) {
  const db = queryDatabase(client)
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 7319))', [
    `agent-slots:${config.actorId}`,
  ])
  const held = await executeDatabaseQuery(
    db
      .select({ slot: agentSlots.slotIndex })
      .from(agentSlots)
      .where(eq(agentSlots.attemptId, attemptId)),
  )
  if (held.length) {
    return true
  }
  await executeDatabaseQuery(
    db
      .insert(agentSlots)
      .values(
        Array.from({ length: MAX_SESSION_SLOTS }, (_, slotIndex) => ({
          actorId: config.actorId,
          slotIndex,
        })),
      )
      .onConflictDoNothing(),
  )
  const occupied = await executeDatabaseQuery(
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(agentSlots)
      .where(and(eq(agentSlots.actorId, config.actorId), isNotNull(agentSlots.attemptId))),
  )
  const lane = await executeDatabaseQuery(
    db
      .select({ attemptId: processingLanes.attemptId })
      .from(processingLanes)
      .where(
        and(eq(processingLanes.actorId, config.actorId), isNotNull(processingLanes.attemptId)),
      ),
  )
  const settingLimit = await sessionLimit(client, config)
  const limit = vmCapacity === undefined ? settingLimit : Math.min(settingLimit, vmCapacity)
  const free = limit - occupied[0].count - lane.length
  if (free <= 0) {
    return false
  }
  const mine = await executeDatabaseQuery(
    db
      .select({
        queuedAt: agentSessions.queuedSince,
        subjectId: processingJobs.subjectId,
        stage: processingJobs.stage,
      })
      .from(agentSessions)
      .innerJoin(processingAttempts, eq(processingAttempts.id, agentSessions.attemptId))
      .innerJoin(processingJobs, eq(processingJobs.id, processingAttempts.jobId))
      .where(eq(agentSessions.attemptId, attemptId)),
  )
  const queuedAt = mine[0]?.queuedAt ?? sql`now()`
  // Examine lead sessions (no subject) go before per-lot sessions, whose lots they form.
  const lead = mine[0] !== undefined && mine[0].subjectId === null
  const older = or(
    lt(agentSessions.queuedSince, queuedAt),
    and(eq(agentSessions.queuedSince, queuedAt), lt(agentSessions.attemptId, attemptId)),
  )
  // Older queued sessions without a slot go first, so sessions start in queue order.
  const ahead = await executeDatabaseQuery(
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(agentSessions)
      .innerJoin(processingAttempts, eq(processingAttempts.id, agentSessions.attemptId))
      .innerJoin(commands, eq(commands.id, processingAttempts.commandId))
      .leftJoin(agentSlots, eq(agentSlots.attemptId, agentSessions.attemptId))
      .innerJoin(captureBatches, eq(captureBatches.id, processingAttempts.batchId))
      .innerJoin(processingJobs, eq(processingJobs.id, processingAttempts.jobId))
      .where(
        and(
          // Archived or paused work does not run, so it holds no place in the queue.
          eq(captureBatches.archived, false),
          notExists(
            db
              .select({ batchId: agentBatchPauses.batchId })
              .from(agentBatchPauses)
              .where(eq(agentBatchPauses.batchId, processingAttempts.batchId)),
          ),
          // The same queue this worker schedules; occupancy above still counts every slot.
          eq(commands.actorId, config.actorId),
          eq(commands.targetId, config.targetId),
          eq(commands.targetContextId, config.targetContextId),
          eq(agentSessions.sessionState, 'queued'),
          // A cancelled attempt never runs, so it holds no place in the queue.
          notInArray(processingAttempts.state, ['cancelled', 'superseded']),
          isNull(agentSlots.slotIndex),
          lead
            ? and(isNull(processingJobs.subjectId), older)
            : or(isNull(processingJobs.subjectId), older),
          // A queued Inventory may be waiting at its gate without a slot, so no session queues
          // behind one: Research and Images it waits for, nor another lot's ready Inventory.
          ne(processingJobs.stage, 'inventory'),
        ),
      ),
  )
  if (ahead[0].count >= free) {
    return false
  }
  const slots = await executeDatabaseQuery(
    db
      .select({ slotIndex: agentSlots.slotIndex })
      .from(agentSlots)
      .where(and(eq(agentSlots.actorId, config.actorId), isNull(agentSlots.attemptId)))
      .orderBy(asc(agentSlots.slotIndex))
      .limit(1)
      .for('update', { skipLocked: true }),
  )
  if (!slots.length) {
    return false
  }
  await executeDatabaseQuery(
    db
      .update(agentSlots)
      .set({ attemptId, claimedAt: new Date() })
      .where(
        and(eq(agentSlots.actorId, config.actorId), eq(agentSlots.slotIndex, slots[0].slotIndex)),
      ),
  )
  return true
}

/** Only settlement or a confirmed reap frees a slot, and its turn's record goes with it. */
export async function releaseSessionSlot(client: PoolClient, attemptId: string) {
  await executeDatabaseQuery(
    queryDatabase(client)
      .update(agentSlots)
      .set({ attemptId: null, claimedAt: null, turn: null, turnChild: null, vmCommand: null })
      .where(eq(agentSlots.attemptId, attemptId)),
  )
}

/**
 * Records the turn a claim started on its slot, in the claim's transaction: nothing outside the
 * worker has started yet, so every slot this build holds says what a restart must confirm.
 */
export async function recordSlotTurn(client: PoolClient, attemptId: string, turn: bigint) {
  await executeDatabaseQuery(
    queryDatabase(client)
      .update(agentSlots)
      .set({ turn, turnChild: 'none', vmCommand: null })
      .where(eq(agentSlots.attemptId, attemptId)),
  )
}

/** What a turn is about to start outside its worker: a host process, or a command to the VM. */
export type TurnChild = { kind: 'host' } | { kind: 'vm'; command: string }

/** The turn's attempt was cancelled, superseded or replaced before it started anything. */
export class TurnAttemptNotRunning extends Error {
  constructor() {
    super('turn_attempt_not_running')
  }
}

/**
 * Whether the attempt is still its job's current running one, read under share locks on the job
 * and then the attempt, the order a cancellation takes them, so a committed cancellation is seen.
 */
async function attemptStillRunning(client: PoolClient, attemptId: string) {
  const attempts = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ jobId: processingAttempts.jobId })
      .from(processingAttempts)
      .where(eq(processingAttempts.id, attemptId)),
  )
  if (!attempts.length) {
    return false
  }
  const jobs = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ currentAttemptId: processingJobs.currentAttemptId })
      .from(processingJobs)
      .where(eq(processingJobs.id, attempts[0].jobId))
      .for('share'),
  )
  const locked = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ state: processingAttempts.state })
      .from(processingAttempts)
      .where(eq(processingAttempts.id, attemptId))
      .for('share'),
  )
  return locked[0]?.state === 'running' && jobs[0]?.currentAttemptId === attemptId
}

/**
 * Commits what a turn is about to start, before it starts it. A turn whose slot no longer holds
 * it refuses, and so does a worker that lost its supervisor lock, so nothing is started that a
 * restart could not find. So does a turn whose attempt has stopped running, so a cancellation
 * committed while the turn waited for its runner sends nothing.
 */
export async function recordTurnChild(
  pool: Pool,
  attemptId: string,
  turn: bigint,
  child: TurnChild,
  fence: SupervisorFence | undefined,
) {
  await transaction(pool, async (client) => {
    await requireSupervisorFence(client, fence, 'ownership')
    if (!(await attemptStillRunning(client, attemptId))) {
      throw new TurnAttemptNotRunning()
    }
    const recorded = await executeDatabaseQuery(
      queryDatabase(client)
        .update(agentSlots)
        .set({ turnChild: child.kind, vmCommand: child.kind === 'vm' ? child.command : null })
        .where(and(eq(agentSlots.attemptId, attemptId), eq(agentSlots.turn, turn)))
        .returning({ slot: agentSlots.slotIndex }),
    )
    if (!recorded.length) {
      throw new Error('turn_child_unrecorded')
    }
  })
}
