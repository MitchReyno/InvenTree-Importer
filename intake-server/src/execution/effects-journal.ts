import { cancellationVersion } from './cancellation.ts'
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import type { Pool, PoolClient } from 'pg'
import { canonical } from '@invimport/contracts/json'
import { sha256 } from '../db/authority.ts'
import { executeDatabaseQuery, queryDatabase } from '../db/database.ts'
import { executorTransaction } from './transaction.ts'
import { lockRun, snapshot } from './authority.ts'
import {
  supportedAssessments,
  supportedEffects,
  executorGuards,
  supportedIntents,
  supportedRecoveries,
  supportedResults,
} from './schema.ts'
import type { EffectsPlan } from './effects-plan.ts'
import { type EffectStep, effectStepKey } from './effects-step.ts'

export type SupportedRecovery = typeof supportedRecoveries.$inferSelect

export type SupportedRequestKind = 'read' | 'create' | 'verify'

export interface SupportedJournalContext {
  pool: Pool
  runId: string
  plan: EffectsPlan
  health: () => Promise<void>
}

export async function authorizeSupportedRequest(
  context: SupportedJournalContext,
  step: EffectStep,
  kind: SupportedRequestKind,
  specification: unknown,
  recovery: SupportedRecovery | undefined,
): Promise<{ planDigest: string; intentId: string; bytes: Buffer } | null> {
  const intentId = randomUUID()
  const bytes = Buffer.from(canonical(specification))
  return executorTransaction(context.pool, async (client) => {
    const authority = await lockRun(client, context.runId)
    await context.health()
    const guard = await executeDatabaseQuery(
      queryDatabase(client)
        .select({ active_run: executorGuards.activeRun })
        .from(executorGuards)
        .where(
          and(
            eq(executorGuards.targetId, context.plan.targetId),
            eq(executorGuards.originalKey, context.plan.originalSourceKey),
          ),
        ),
    )
    if (guard[0]?.active_run !== context.runId) {
      throw new Error('source_not_owned')
    }
    const version = await cancellationVersion(client, context.runId)
    if (version !== '0' && !recovery) {
      return null
    }
    if (
      recovery &&
      (recovery.cancelVersion !== BigInt(version) || recovery.operationKey !== effectStepKey(step))
    ) {
      throw new Error('recovery_authority_changed')
    }
    if (kind === 'create') {
      await refuseUnrecoverableCreate(client, context.runId, step, recovery)
    }
    const previous = await executeDatabaseQuery(
      queryDatabase(client)
        .select({
          recoveryId: supportedIntents.recoveryId,
          requestBytes: supportedIntents.requestBytes,
        })
        .from(supportedIntents)
        .where(
          and(
            eq(supportedIntents.runId, context.runId),
            eq(supportedIntents.operationKey, effectStepKey(step)),
            eq(supportedIntents.kind, kind),
          ),
        ),
    )
    if (
      previous.some(
        (row) => row.requestBytes.equals(bytes) && (!recovery || row.recoveryId === recovery.id),
      )
    ) {
      throw new Error('selected_effect_recovery_required')
    }
    await executeDatabaseQuery(
      queryDatabase(client)
        .insert(supportedIntents)
        .values({
          id: intentId,
          runId: context.runId,
          operationKey: effectStepKey(step),
          recoveryId: recovery?.id ?? null,
          kind,
          attempt: previous.length + 1,
          requestBytes: bytes,
          requestDigest: sha256(bytes),
        }),
    )
    return { planDigest: authority.planDigest, intentId, bytes }
  })
}

async function refuseUnrecoverableCreate(
  client: PoolClient,
  runId: string,
  step: EffectStep,
  recovery: SupportedRecovery | undefined,
) {
  if ((await snapshot(client, runId)).state === 'recovery_required') {
    throw new Error('unknown_effect_blocks_create')
  }
  if (recovery?.kind === 'verify_effect') {
    throw new Error('assessment_is_read_only')
  }
  const creates = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ certainty: supportedEffects.certainty })
      .from(supportedIntents)
      .leftJoin(supportedEffects, eq(supportedEffects.intentId, supportedIntents.id))
      .where(
        and(
          eq(supportedIntents.runId, runId),
          eq(supportedIntents.operationKey, effectStepKey(step)),
          eq(supportedIntents.kind, 'create'),
        ),
      ),
  )
  if (creates.some((row) => row.certainty !== 'none')) {
    throw new Error('effect_create_not_recoverable')
  }
}

export async function checkpointSupportedRequest(
  context: SupportedJournalContext,
  step: EffectStep,
  kind: SupportedRequestKind,
  intentId: string,
  outcome: 'response' | 'transport_loss' | 'proven_not_sent',
  received: { status: number; bytes: Buffer } | null,
  evidence: { pks: string[]; confirmed: boolean },
) {
  await executorTransaction(context.pool, async (client) => {
    await lockRun(client, context.runId)
    const db = queryDatabase(client)
    await executeDatabaseQuery(
      db.insert(supportedResults).values({
        intentId,
        outcome,
        status: received?.status ?? null,
        responseBytes: received && received.bytes.length <= 65536 ? received.bytes : null,
        responseDigest: received ? sha256(received.bytes) : null,
        responseSize: received ? BigInt(received.bytes.length) : null,
      }),
    )
    if (kind === 'create') {
      await executeDatabaseQuery(
        db.insert(supportedEffects).values({
          intentId,
          runId: context.runId,
          operationKey: effectStepKey(step),
          certainty:
            outcome === 'proven_not_sent' ? 'none' : evidence.confirmed ? 'confirmed' : 'unknown',
          remotePks: evidence.pks,
        }),
      )
    }
  })
}

export async function recordSupportedAssessment(
  pool: Pool,
  runId: string,
  operationKey: string,
  intentId: string,
  createIntentId: string,
  outcome: 'matches' | 'missing_or_changed' | 'unavailable',
  remotePk: string,
) {
  await executorTransaction(pool, async (client) => {
    await lockRun(client, runId)
    await executeDatabaseQuery(
      queryDatabase(client).insert(supportedAssessments).values({
        id: randomUUID(),
        intentId,
        createIntentId,
        runId,
        operationKey,
        outcome,
        remotePk,
      }),
    )
  })
}
