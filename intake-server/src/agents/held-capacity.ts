import { and, eq, isNotNull, sql } from 'drizzle-orm'
import type { PoolClient } from 'pg'
import { executeDatabaseQuery, queryDatabase } from '#/db/database.ts'
import { commands } from '#/db/schema.ts'
import type { ProcessingConfig } from '#/processing/attempts.ts'
import { processingAttempts, processingLanes } from '#/processing/schema.ts'
import { agentSessions, agentSlots, type TurnChildKind } from './schema.ts'
import { interruptSession } from './session/session-runner.ts'

/** How long a starting worker waits for the guest's removal proof for one held VM turn. */
export const STARTUP_REAP_CHECK_MS = 20_000

/** A slot or the Processing lane still held by an attempt when a worker starts. */
export type HeldCapacity =
  | {
      holds: 'slot'
      attemptId: string
      turn: bigint | null
      child: TurnChildKind | null
      vmCommand: string | null
      /** Whether the attempt is in this worker's target and context, so it can interrupt it. */
      inScope: boolean
    }
  | { holds: 'lane'; attemptId: string }

/** The guest's answer for a held VM turn: removal confirmed, not confirmed, or no bridge to ask. */
export type VmReapProof = 'removed' | 'unconfirmed' | 'unavailable'

export type ReleaseReason = 'no_child' | 'vm_worker_removed'

export type KeepReason =
  | 'turn_child_unrecorded'
  | 'host_child_unverifiable'
  | 'lane_child_unverifiable'
  | 'vm_bridge_unavailable'
  | 'vm_reap_unconfirmed'
  | 'held_capacity_changed'
  | 'held_by_other_scope'

export type HeldCapacityVerdict =
  { release: true; reason: ReleaseReason } | { release: false; reason: KeepReason }

/**
 * Whether held capacity may be released. Only a turn that started nothing outside its worker, or
 * a VM turn whose removal the guest confirmed, may be; every unknown keeps it.
 */
export function heldCapacityVerdict(held: HeldCapacity, proof?: VmReapProof): HeldCapacityVerdict {
  if (held.holds === 'lane') {
    return { release: false, reason: 'lane_child_unverifiable' }
  }
  // Releasing it would leave its session for a worker of another target or context to interrupt.
  if (!held.inScope) {
    return { release: false, reason: 'held_by_other_scope' }
  }
  switch (held.child) {
    case null:
      return { release: false, reason: 'turn_child_unrecorded' }
    case 'none':
      return { release: true, reason: 'no_child' }
    case 'host':
      return { release: false, reason: 'host_child_unverifiable' }
    case 'vm':
      if (proof === 'removed') {
        return { release: true, reason: 'vm_worker_removed' }
      }
      if (proof === 'unavailable') {
        return { release: false, reason: 'vm_bridge_unavailable' }
      }
      return { release: false, reason: 'vm_reap_unconfirmed' }
  }
}

export interface HeldCapacityChecks {
  /** Asks the paired guest whether a recorded VM command's worker was removed. */
  confirmVmReaped?: (command: string, signal: AbortSignal) => Promise<boolean>
  /** Ends every check early, for example when the worker loses its supervisor lock. */
  signal?: AbortSignal
  /**
   * Interrupts each released slot's session in the release's transaction, as a normal start
   * does; the check-only mode leaves that to the next start.
   */
  interruptReleased?: boolean
  /** Overrides `STARTUP_REAP_CHECK_MS`, for tests. */
  reapCheckMs?: number
}

export interface HeldCapacityOutcome {
  holds: HeldCapacity['holds']
  attemptId: string
  released: boolean
  reason: ReleaseReason | KeepReason
}

async function readHeldCapacity(
  owner: PoolClient,
  config: ProcessingConfig,
): Promise<HeldCapacity[]> {
  const slots = await executeDatabaseQuery(
    queryDatabase(owner)
      .select({
        attemptId: agentSlots.attemptId,
        turn: agentSlots.turn,
        child: agentSlots.turnChild,
        vmCommand: agentSlots.vmCommand,
        targetId: commands.targetId,
        targetContextId: commands.targetContextId,
      })
      .from(agentSlots)
      .leftJoin(processingAttempts, eq(processingAttempts.id, agentSlots.attemptId))
      .leftJoin(commands, eq(commands.id, processingAttempts.commandId))
      .where(and(eq(agentSlots.actorId, config.actorId), isNotNull(agentSlots.attemptId)))
      .orderBy(agentSlots.slotIndex),
  )
  const lanes = await executeDatabaseQuery(
    queryDatabase(owner)
      .select({ attemptId: processingLanes.attemptId })
      .from(processingLanes)
      .where(
        and(eq(processingLanes.actorId, config.actorId), isNotNull(processingLanes.attemptId)),
      ),
  )
  const heldSlots: HeldCapacity[] = slots.map((slot) => ({
    holds: 'slot',
    attemptId: slot.attemptId!,
    turn: slot.turn,
    child: slot.child,
    vmCommand: slot.vmCommand,
    inScope: slot.targetId === config.targetId && slot.targetContextId === config.targetContextId,
  }))
  const heldLanes: HeldCapacity[] = lanes.map((lane) => ({
    holds: 'lane',
    attemptId: lane.attemptId!,
  }))
  return [...heldSlots, ...heldLanes]
}

/** Asks the guest about a held VM turn within the check's bound; a failed ask confirms nothing. */
async function vmReapProof(held: HeldCapacity, checks: HeldCapacityChecks): Promise<VmReapProof> {
  // Another scope's command is never sent to this worker's guest; its slot is kept anyway.
  if (held.holds !== 'slot' || !held.inScope || held.child !== 'vm' || held.vmCommand === null) {
    return 'unconfirmed'
  }
  if (!checks.confirmVmReaped) {
    return 'unavailable'
  }
  const bound = AbortSignal.timeout(checks.reapCheckMs ?? STARTUP_REAP_CHECK_MS)
  const signal = checks.signal ? AbortSignal.any([bound, checks.signal]) : bound
  try {
    return (await checks.confirmVmReaped(held.vmCommand, signal)) ? 'removed' : 'unconfirmed'
  } catch {
    return 'unconfirmed'
  }
}

/**
 * Releases a confirmed slot as settlement does, in one statement that matches the exact turn the
 * verdict was about, so a record committed meanwhile (a driver's intent) keeps it. It runs on the
 * supervisor lock's own connection: a worker that lost the lock can release nothing.
 */
async function releaseConfirmedSlot(
  owner: PoolClient,
  config: ProcessingConfig,
  held: Extract<HeldCapacity, { holds: 'slot' }>,
  interruptReleased: boolean,
) {
  await owner.query('BEGIN')
  try {
    // Job, attempt and session before the slot, the order settlement takes them in.
    if (interruptReleased) {
      await interruptHeldSession(owner, held.attemptId)
    }
    const released = await executeDatabaseQuery(
      queryDatabase(owner)
        .update(agentSlots)
        .set({ attemptId: null, claimedAt: null, turn: null, turnChild: null, vmCommand: null })
        .where(
          and(
            eq(agentSlots.actorId, config.actorId),
            eq(agentSlots.attemptId, held.attemptId),
            sql`${agentSlots.turn} IS NOT DISTINCT FROM ${held.turn}::bigint`,
            sql`${agentSlots.turnChild} IS NOT DISTINCT FROM ${held.child}::text`,
            sql`${agentSlots.vmCommand} IS NOT DISTINCT FROM ${held.vmCommand}::text`,
          ),
        )
        .returning({ slot: agentSlots.slotIndex }),
    )
    if (released.length !== 1) {
      // The slot changed after its check: neither the release nor the interruption happens.
      await owner.query('ROLLBACK')
      return false
    }
    await owner.query('COMMIT')
    return true
  } catch (error) {
    await owner.query('ROLLBACK').catch(() => undefined)
    throw error
  }
}

/** Interrupts the session of a released slot's attempt, when it is still running or cancelling. */
async function interruptHeldSession(owner: PoolClient, attemptId: string) {
  const sessions = await executeDatabaseQuery(
    queryDatabase(owner)
      .select({
        attemptId: agentSessions.attemptId,
        jobId: processingAttempts.jobId,
        batchId: processingAttempts.batchId,
        turnCount: agentSessions.turnCount,
      })
      .from(agentSessions)
      .innerJoin(processingAttempts, eq(processingAttempts.id, agentSessions.attemptId))
      .where(eq(agentSessions.attemptId, attemptId)),
  )
  const session = sessions[0]
  if (!session) {
    return false
  }
  return interruptSession(owner, session)
}

/**
 * Checks each slot and the lane still held for this actor, and releases the slots confirmed gone.
 * `owner` is the connection holding the actor's supervisor lock, so no other worker runs these
 * turns; their sessions are left for `interruptRunningSessions`. Nothing is stopped or killed.
 */
export async function recoverHeldCapacity(
  owner: PoolClient,
  config: ProcessingConfig,
  checks: HeldCapacityChecks = {},
): Promise<HeldCapacityOutcome[]> {
  const held = await readHeldCapacity(owner, config)
  // Each VM turn is asked about at once, each within its own bound.
  const proofs = await Promise.all(held.map((item) => vmReapProof(item, checks)))
  const outcomes: HeldCapacityOutcome[] = []
  for (const [index, item] of held.entries()) {
    const verdict = heldCapacityVerdict(item, proofs[index])
    let released = false
    let reason: HeldCapacityOutcome['reason'] = verdict.reason
    if (verdict.release && item.holds === 'slot') {
      checks.signal?.throwIfAborted()
      released = await releaseConfirmedSlot(owner, config, item, checks.interruptReleased ?? false)
      if (!released) {
        reason = 'held_capacity_changed'
      }
    }
    outcomes.push({ holds: item.holds, attemptId: item.attemptId, released, reason })
  }
  return outcomes
}

/** One log line per outcome: attempt IDs and fixed reasons only. */
export function reportHeldCapacity(outcomes: HeldCapacityOutcome[]) {
  for (const outcome of outcomes) {
    const event = outcome.released ? 'held_capacity_released' : 'agent_reap_unconfirmed'
    process.stderr.write(
      JSON.stringify({
        event,
        holds: outcome.holds,
        attempt_id: outcome.attemptId,
        reason: outcome.reason,
      }) + '\n',
    )
  }
}

/** Recovers what it can, logs every outcome, and refuses while anything stays held. */
export async function requireFreeCapacity(
  owner: PoolClient,
  config: ProcessingConfig,
  checks: HeldCapacityChecks = {},
) {
  const outcomes = await recoverHeldCapacity(owner, config, checks)
  reportHeldCapacity(outcomes)
  if (outcomes.some((outcome) => !outcome.released)) {
    throw new Error('agent_reap_confirmation_required')
  }
  return outcomes
}

/** Recover-only mode's last line, once every held slot it found was released. */
export function heldCapacityChecked(released: number) {
  return `${JSON.stringify({ event: 'held_capacity_checked', released })}\n`
}
