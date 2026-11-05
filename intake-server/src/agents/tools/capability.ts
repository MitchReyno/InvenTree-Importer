import { createHash, randomBytes } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import type { Pool, PoolClient } from 'pg'
import { executeDatabaseQuery, queryDatabase } from '../../db/database.ts'
import { agentSessions } from '../schema.ts'
import { processingAttempts, processingInputs, processingJobs } from '../../processing/schema.ts'
import { decodeSessionInput } from '../../processing/session-input.ts'
import { isSessionProfile } from '../../processing/session-policy.ts'

const digest = (token: string) => createHash('sha256').update(token).digest()

/** Issues a fresh capability for one provider run; only its SHA-256 is stored. */
export async function issueSessionCapability(client: PoolClient, attemptId: string) {
  const token = randomBytes(32).toString('base64url')
  const updated = await executeDatabaseQuery(
    queryDatabase(client)
      .update(agentSessions)
      .set({ capabilitySha256: digest(token) })
      .where(and(eq(agentSessions.attemptId, attemptId), eq(agentSessions.sessionState, 'running')))
      .returning({ attemptId: agentSessions.attemptId }),
  )
  if (updated.length !== 1) {
    throw new Error('session_not_running')
  }
  return token
}

/** Revoked at turn end, cancellation, interruption and worker start. */
export async function revokeSessionCapability(client: PoolClient, attemptId: string) {
  await executeDatabaseQuery(
    queryDatabase(client)
      .update(agentSessions)
      .set({ capabilitySha256: null })
      .where(eq(agentSessions.attemptId, attemptId)),
  )
}

export type SessionPrincipal = NonNullable<Awaited<ReturnType<typeof resolveSessionCapability>>>

/** A capability names exactly one running session; anything else resolves to nothing. */
export async function resolveSessionCapability(pool: Pool | PoolClient, token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    return undefined
  }
  const rows = await executeDatabaseQuery(
    queryDatabase(pool)
      .select({
        attemptId: agentSessions.attemptId,
        lineageId: agentSessions.sessionLineageId,
        jobId: processingJobs.id,
        batchId: processingJobs.batchId,
        subjectId: processingJobs.subjectId,
        stage: processingJobs.stage,
        profileId: processingAttempts.profileId,
        commandId: processingAttempts.commandId,
        inputBytes: processingInputs.manifestBytes,
        inputDigest: processingInputs.manifestDigest,
      })
      .from(agentSessions)
      .innerJoin(processingAttempts, eq(processingAttempts.id, agentSessions.attemptId))
      .innerJoin(processingJobs, eq(processingJobs.id, processingAttempts.jobId))
      .innerJoin(processingInputs, eq(processingInputs.id, processingAttempts.inputId))
      .where(
        and(
          eq(agentSessions.capabilitySha256, digest(token)),
          eq(agentSessions.sessionState, 'running'),
        ),
      ),
  )
  const row = rows[0]
  if (
    !row ||
    rows.length !== 1 ||
    !isSessionProfile(row.profileId) ||
    row.lineageId !== row.jobId
  ) {
    return undefined
  }
  return { ...row, manifest: decodeSessionInput(row.inputBytes, row.inputDigest) }
}
