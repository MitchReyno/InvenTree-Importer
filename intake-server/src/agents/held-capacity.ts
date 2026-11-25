import { and, eq, isNotNull } from 'drizzle-orm'
import type { Pool } from 'pg'
import { executeDatabaseQuery, queryDatabase, transaction } from '#/db/database.ts'
import type { ProcessingConfig } from '#/processing/attempts.ts'
import { processingLanes } from '#/processing/schema.ts'
import { agentSlots, type TurnChildKind } from './schema.ts'
import { releaseSessionSlot } from './session/slots.ts'

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
  /** Overrides `STARTUP_REAP_CHECK_MS`, for tests. */
  reapCheckMs?: number
}

export interface HeldCapacityOutcome {
  holds: HeldCapacity['holds']
  attemptId: string
  released: boolean
  reason: ReleaseReason | KeepReason
}

async function readHeldCapacity(pool: Pool, config: ProcessingConfig): Promise<HeldCapacity[]> {
  const slots = await executeDatabaseQuery(
    queryDatabase(pool)
      .select({
        attemptId: agentSlots.attemptId,
        turn: agentSlots.turn,
        child: agentSlots.turnChild,
        vmCommand: agentSlots.vmCommand,
      })
      .from(agentSlots)
      .where(and(eq(agentSlots.actorId, config.actorId), isNotNull(agentSlots.attemptId)))
      .orderBy(agentSlots.slotIndex),
  )
  const lanes = await executeDatabaseQuery(
    queryDatabase(pool)
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
  }))
  const heldLanes: HeldCapacity[] = lanes.map((lane) => ({
    holds: 'lane',
    attemptId: lane.attemptId!,
  }))
  return [...heldSlots, ...heldLanes]
}

/** Asks the guest about a held VM turn within the check's bound; a failed ask confirms nothing. */
async function vmReapProof(held: HeldCapacity, checks: HeldCapacityChecks): Promise<VmReapProof> {
  if (held.holds !== 'slot' || held.child !== 'vm' || held.vmCommand === null) {
    return 'unconfirmed'
  }
  if (!checks.confirmVmReaped) {
    return 'unavailable'
  }
  const signal = AbortSignal.timeout(checks.reapCheckMs ?? STARTUP_REAP_CHECK_MS)
  try {
    return (await checks.confirmVmReaped(held.vmCommand, signal)) ? 'removed' : 'unconfirmed'
  } catch {
    return 'unconfirmed'
  }
}

/**
 * Releases a confirmed slot as settlement does, under the lock slot claims take, and only while
 * it still holds the turn the verdict was about.
 */
async function releaseConfirmedSlot(
  pool: Pool,
  config: ProcessingConfig,
  held: Extract<HeldCapacity, { holds: 'slot' }>,
) {
  return transaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 7319))', [
      `agent-slots:${config.actorId}`,
    ])
    const rows = await executeDatabaseQuery(
      queryDatabase(client)
        .select({
          turn: agentSlots.turn,
          child: agentSlots.turnChild,
          vmCommand: agentSlots.vmCommand,
        })
        .from(agentSlots)
        .where(
          and(eq(agentSlots.actorId, config.actorId), eq(agentSlots.attemptId, held.attemptId)),
        ),
    )
    const current = rows[0]
    const unchanged =
      current !== undefined &&
      current.turn === held.turn &&
      current.child === held.child &&
      current.vmCommand === held.vmCommand
    if (!unchanged) {
      return false
    }
    await releaseSessionSlot(client, held.attemptId)
    return true
  })
}

/**
 * Checks each slot and the lane still held for this actor, and releases the slots confirmed gone.
 * The caller holds the actor's supervisor lock, so no other worker runs these turns; their
 * sessions are left for `interruptRunningSessions`. Nothing is stopped or killed here.
 */
export async function recoverHeldCapacity(
  pool: Pool,
  config: ProcessingConfig,
  checks: HeldCapacityChecks = {},
): Promise<HeldCapacityOutcome[]> {
  const held = await readHeldCapacity(pool, config)
  // Each VM turn is asked about at once, each within its own bound.
  const proofs = await Promise.all(held.map((item) => vmReapProof(item, checks)))
  const outcomes: HeldCapacityOutcome[] = []
  for (const [index, item] of held.entries()) {
    const verdict = heldCapacityVerdict(item, proofs[index])
    let released = false
    let reason: HeldCapacityOutcome['reason'] = verdict.reason
    if (verdict.release && item.holds === 'slot') {
      released = await releaseConfirmedSlot(pool, config, item)
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
  pool: Pool,
  config: ProcessingConfig,
  checks: HeldCapacityChecks = {},
) {
  const outcomes = await recoverHeldCapacity(pool, config, checks)
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
