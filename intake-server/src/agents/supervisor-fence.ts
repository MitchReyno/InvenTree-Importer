import type { PoolClient } from 'pg'

/** `hashtextextended` seeds: the supervisor lock, and the fence ordering writes against a new one. */
export const SUPERVISOR_LOCK_SEED = 7318
const SUPERVISOR_FENCE_SEED = 7320

/** How long a new supervisor waits for a lost worker's fenced writes before refusing to start. */
export const SUPERVISOR_FENCE_WAIT_MS = 30_000

export function supervisorLockName(actorId: string) {
  return `agent-supervisor:${actorId}`
}

function supervisorFenceName(actorId: string) {
  return `agent-supervisor-fence:${actorId}`
}

/** The connection holding a worker's supervisor lock: its backend PID and start, in microseconds. */
export interface SupervisorFence {
  actorId: string
  backendPid: number
  backendStartMicros: string
}

/** Whoever holds the actor's supervisor lock now, or null; a start this role can't see is null. */
export type SupervisorHolder = { backendPid: number; backendStartMicros: string | null } | null

/**
 * `ownership` writes start or extend held capacity (a slot claim, a turn child record, a lane
 * claim); `settlement` ends a turn and releases its slot.
 */
export type FencedWrite = 'ownership' | 'settlement'

function heldByThisWorker(fence: SupervisorFence, holder: SupervisorHolder) {
  return (
    holder !== null &&
    holder.backendPid === fence.backendPid &&
    holder.backendStartMicros === fence.backendStartMicros
  )
}

/**
 * Ownership needs this worker's connection to hold the lock. Settlement only needs no other worker
 * to hold it: a worker that lost its lock may still settle a turn whose child it confirmed gone,
 * and a supervisor that takes the lock afterwards waits for that settlement before its check.
 */
export function fencePermits(fence: SupervisorFence, holder: SupervisorHolder, write: FencedWrite) {
  if (heldByThisWorker(fence, holder)) {
    return true
  }
  return write === 'settlement' && holder === null
}

/** Reads the identity of the connection that has just taken the supervisor lock. */
export async function readSupervisorFence(
  owner: PoolClient,
  actorId: string,
): Promise<SupervisorFence> {
  const identity = await owner.query<{ pid: number; started: string }>(
    `SELECT activity.pid,
            (extract(epoch FROM activity.backend_start) * 1000000)::bigint::text AS started
       FROM pg_stat_activity activity
      WHERE activity.pid = pg_backend_pid()`,
  )
  const row = identity.rows[0]
  if (!row) {
    throw new Error('agent_supervisor_identity_unavailable')
  }
  return { actorId, backendPid: row.pid, backendStartMicros: row.started }
}

/** The supervisor lock's holder, read from PostgreSQL's lock table in the caller's transaction. */
async function readSupervisorHolder(
  client: PoolClient,
  actorId: string,
): Promise<SupervisorHolder> {
  // A bigint advisory key shows in `pg_locks` as its high and low 32 bits, with `objsubid` 1.
  const holders = await client.query<{ pid: number; started: string | null }>(
    `WITH supervisor AS (SELECT hashtextextended($1, $2) AS key)
     SELECT held.pid,
            (extract(epoch FROM activity.backend_start) * 1000000)::bigint::text AS started
       FROM pg_locks held
       CROSS JOIN supervisor
       LEFT JOIN pg_stat_activity activity ON activity.pid = held.pid
      WHERE held.locktype = 'advisory'
        AND held.granted
        AND held.mode = 'ExclusiveLock'
        AND held.database = (SELECT oid FROM pg_database WHERE datname = current_database())
        AND held.classid = ((supervisor.key >> 32) & 4294967295)::oid
        AND held.objid = (supervisor.key & 4294967295)::oid
        AND held.objsubid = 1`,
    [supervisorLockName(actorId), SUPERVISOR_LOCK_SEED],
  )
  const holder = holders.rows[0]
  if (!holder) {
    return null
  }
  return { backendPid: holder.pid, backendStartMicros: holder.started }
}

/**
 * Run first in a transaction that claims, records or settles held capacity. It takes the fence's
 * shared lock, which a new supervisor's `awaitFencedWrites` waits for, then refuses unless the
 * write is permitted: a write that passes commits before a replacement's check, and one that
 * starts after a replacement took the lock is refused. A writer with no supervisor (the media and
 * research workers, and tests that run turns without one) passes no fence and is not fenced.
 */
export async function requireSupervisorFence(
  client: PoolClient,
  fence: SupervisorFence | undefined,
  write: FencedWrite,
) {
  if (!fence) {
    return
  }
  await client.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1, $2))', [
    supervisorFenceName(fence.actorId),
    SUPERVISOR_FENCE_SEED,
  ])
  const holder = await readSupervisorHolder(client, fence.actorId)
  if (!fencePermits(fence, holder, write)) {
    throw new Error('agent_supervisor_lock_lost')
  }
}

const LOCK_NOT_AVAILABLE = '55P03'

function lockTimedOut(error: unknown) {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === LOCK_NOT_AVAILABLE
  )
}

/**
 * Run by a new supervisor once it holds the lock, before its held-capacity check: waits for every
 * fenced transaction already past its check, within `waitMs`, so none commits after the check.
 */
export async function awaitFencedWrites(
  owner: PoolClient,
  actorId: string,
  waitMs = SUPERVISOR_FENCE_WAIT_MS,
) {
  await owner.query('BEGIN')
  try {
    await owner.query("SELECT set_config('lock_timeout', $1, true)", [`${waitMs}ms`])
    await owner.query('SELECT pg_advisory_xact_lock(hashtextextended($1, $2))', [
      supervisorFenceName(actorId),
      SUPERVISOR_FENCE_SEED,
    ])
    await owner.query('COMMIT')
  } catch (error) {
    await owner.query('ROLLBACK').catch(() => undefined)
    if (lockTimedOut(error)) {
      throw new Error('agent_supervisor_writes_in_flight')
    }
    throw error
  }
}
