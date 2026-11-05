import { and, eq } from 'drizzle-orm'
import type { Pool, PoolClient } from 'pg'
import { canonical } from '@invimport/contracts/json'
import { sha256, verifyBytes } from '../db/authority.ts'
import { executeDatabaseQuery, queryDatabase } from '../db/database.ts'
import { retainPartTransfers, requirePartTransfers } from './part-attachment-index.ts'
import {
  executorRuns,
  executorApprovals,
  partIdentities,
  recordIdentities,
  supportedAssessments,
  supportedEffects,
  supportedIntents,
  supportedOperations,
} from './schema.ts'
import { supportedStates } from './effects-state.ts'
import {
  companyCreateKey,
  decodeEffectsPlan,
  locationCreateKey,
  logicalEffectKey,
  type EffectsPlan,
  type RecordPrior,
} from './effects-plan.ts'

export function indexedSupportedOperations(plan: EffectsPlan) {
  return [
    ...plan.effects.map((effect) => ({
      key: effect.operationKey,
      subject: effect.partSubjectId,
      kind: effect.kind,
      spec: effect,
    })),
    ...plan.operations.map((operation) => ({
      key: operation.operationKey,
      subject: null,
      kind: 'create_stock',
      spec: operation,
    })),
  ]
}

export async function retainSupportedIndex(client: PoolClient, runId: string, plan: EffectsPlan) {
  const db = queryDatabase(client)
  for (const operation of indexedSupportedOperations(plan)) {
    const bytes = Buffer.from(canonical(operation.spec))
    await executeDatabaseQuery(
      db.insert(supportedOperations).values({
        runId,
        operationKey: operation.key,
        partSubjectId: operation.subject,
        kind: operation.kind,
        specBytes: bytes,
        specDigest: sha256(bytes),
      }),
    )
  }
  await retainPartTransfers(client, runId, plan)
  for (const binding of recordBindings(plan)) {
    if (binding.prior) {
      await requirePriorRecord(client, plan, binding.draftId, binding.specDigest, binding.prior)
      continue
    }
    await executeDatabaseQuery(
      db.insert(recordIdentities).values({
        targetId: plan.targetId,
        originalKey: plan.originalSourceKey,
        draftId: binding.draftId,
        kind: binding.kind,
        runId,
        operationKey: binding.key,
        specDigest: Buffer.from(binding.specDigest, 'hex'),
      }),
    )
  }
  for (const binding of plan.parts) {
    if (!binding.prior) {
      await executeDatabaseQuery(
        db.insert(partIdentities).values({
          targetId: plan.targetId,
          originalKey: plan.originalSourceKey,
          partSubjectId: binding.subjectId,
          runId,
          operationKey: logicalEffectKey(binding.subjectId, 'create_part'),
          specDigest: Buffer.from(binding.specDigest, 'hex'),
        }),
      )
    } else {
      await requirePriorPart(client, plan, binding.subjectId, binding.specDigest, binding.prior)
    }
  }
}

export async function requirePriorPart(
  client: Pool | PoolClient,
  plan: EffectsPlan,
  subjectId: string,
  specDigest: string,
  prior: { runId: string; intentId: string; pk: string },
) {
  const db = queryDatabase(client)
  const createdParts = await executeDatabaseQuery(
    db
      .select({
        operationKey: partIdentities.operationKey,
        specDigest: partIdentities.specDigest,
        remotePks: supportedEffects.remotePks,
        certainty: supportedEffects.certainty,
      })
      .from(partIdentities)
      .innerJoin(
        supportedIntents,
        and(
          eq(supportedIntents.runId, partIdentities.runId),
          eq(supportedIntents.operationKey, partIdentities.operationKey),
          eq(supportedIntents.kind, 'create'),
        ),
      )
      .innerJoin(supportedEffects, eq(supportedEffects.intentId, supportedIntents.id))
      .where(
        and(
          eq(partIdentities.targetId, plan.targetId),
          eq(partIdentities.originalKey, plan.originalSourceKey),
          eq(partIdentities.partSubjectId, subjectId),
          eq(partIdentities.runId, prior.runId),
          eq(supportedIntents.id, prior.intentId),
        ),
      ),
  )
  const row = createdParts[0]
  if (
    !row ||
    row.specDigest.toString('hex') !== specDigest ||
    row.remotePks.length !== 1 ||
    row.remotePks[0] !== prior.pk
  ) {
    throw new Error('prior_part_binding_invalid')
  }
  const approved = await executeDatabaseQuery(
    queryDatabase(client)
      .select({
        plan_bytes: executorApprovals.planBytes,
        plan_digest: executorApprovals.planDigest,
      })
      .from(executorRuns)
      .innerJoin(executorApprovals, eq(executorApprovals.id, executorRuns.approvalId))
      .where(eq(executorRuns.id, prior.runId)),
  )
  const retained = approved[0]
  if (!retained) {
    throw new Error('prior_part_authority_missing')
  }
  const original = decodeEffectsPlan(retained.plan_bytes, retained.plan_digest)
  const binding = original.parts.find((part) => part.subjectId === subjectId)
  if (
    original.targetId !== plan.targetId ||
    original.originalSourceKey !== plan.originalSourceKey ||
    !binding ||
    binding.prior !== null ||
    binding.specDigest !== specDigest
  ) {
    throw new Error('prior_part_binding_invalid')
  }
  const state = (await supportedStates(client, prior.runId, original)).find(
    (state) => state.operationKey === row.operationKey,
  )
  if (
    state?.certainty !== 'confirmed' ||
    state.remotePks.length !== 1 ||
    state.remotePks[0] !== prior.pk ||
    state.createIntentId !== prior.intentId
  ) {
    throw new Error('prior_part_unconfirmed')
  }
  if (row.certainty !== 'confirmed') {
    const verified = await executeDatabaseQuery(
      db
        .select({ id: supportedAssessments.id })
        .from(supportedAssessments)
        .where(
          and(
            eq(supportedAssessments.runId, prior.runId),
            eq(supportedAssessments.createIntentId, prior.intentId),
            eq(supportedAssessments.remotePk, prior.pk),
            eq(supportedAssessments.outcome, 'matches'),
          ),
        ),
    )
    if (!verified.length) {
      throw new Error('prior_part_unconfirmed')
    }
  }
}

export async function requireSupportedIndex(
  client: Pool | PoolClient,
  runId: string,
  plan: EffectsPlan,
) {
  const db = queryDatabase(client)
  const indexed = await executeDatabaseQuery(
    db.select().from(supportedOperations).where(eq(supportedOperations.runId, runId)),
  )
  const expected = indexedSupportedOperations(plan)
  if (indexed.length !== expected.length) {
    throw new Error('supported_index_missing')
  }
  for (const operation of expected) {
    const stored = indexed.find((row) => row.operationKey === operation.key)
    if (!stored || stored.kind !== operation.kind || stored.partSubjectId !== operation.subject) {
      throw new Error('supported_index_mismatch')
    }
    verifyBytes(stored.specBytes, stored.specDigest)
    if (stored.specBytes.toString('utf8') !== canonical(operation.spec)) {
      throw new Error('supported_index_mismatch')
    }
  }
  await requirePartTransfers(client, runId, plan)
  await requireRecordIdentities(client, runId, plan)
  for (const binding of plan.parts) {
    if (binding.prior) {
      await requirePriorPart(client, plan, binding.subjectId, binding.specDigest, binding.prior)
    } else {
      const identities = await executeDatabaseQuery(
        db
          .select({
            runId: partIdentities.runId,
            operationKey: partIdentities.operationKey,
            specDigest: partIdentities.specDigest,
          })
          .from(partIdentities)
          .where(
            and(
              eq(partIdentities.targetId, plan.targetId),
              eq(partIdentities.originalKey, plan.originalSourceKey),
              eq(partIdentities.partSubjectId, binding.subjectId),
            ),
          ),
      )
      const row = identities[0]
      if (
        !row ||
        row.runId !== runId ||
        row.operationKey !== logicalEffectKey(binding.subjectId, 'create_part') ||
        row.specDigest.toString('hex') !== binding.specDigest
      ) {
        throw new Error('part_identity_missing')
      }
    }
  }
}

/** A reused record must be the exact confirmed output of the original run's create. */
export async function requirePriorRecord(
  client: Pool | PoolClient,
  plan: EffectsPlan,
  draftId: string,
  specDigest: string,
  prior: RecordPrior,
) {
  const operationKey = await requirePriorRecordIdentity(client, plan, draftId, specDigest, prior)
  // Journal-derived state: an explicit positive inspection confirms an uncertain create.
  const states = await supportedStates(client, prior.runId, await priorPlan(client, prior.runId))
  const state = states.find((item) => item.operationKey === operationKey)
  if (
    state?.certainty !== 'confirmed' ||
    state.createIntentId !== prior.intentId ||
    state.remotePks.length !== 1 ||
    state.remotePks[0] !== prior.pk ||
    state.verification === 'missing_or_changed' ||
    state.verification === 'unavailable'
  ) {
    throw new Error('prior_record_unconfirmed')
  }
}

/** The immutable part of a reuse binding: the original run's identity row and spec digest. */
async function requirePriorRecordIdentity(
  client: Pool | PoolClient,
  plan: EffectsPlan,
  draftId: string,
  specDigest: string,
  prior: RecordPrior,
) {
  const rows = await executeDatabaseQuery(
    queryDatabase(client)
      .select({
        specDigest: recordIdentities.specDigest,
        operationKey: recordIdentities.operationKey,
      })
      .from(recordIdentities)
      .where(
        and(
          eq(recordIdentities.targetId, plan.targetId),
          eq(recordIdentities.originalKey, plan.originalSourceKey),
          eq(recordIdentities.draftId, draftId),
          eq(recordIdentities.runId, prior.runId),
        ),
      ),
  )
  const row = rows[0]
  if (!row || row.specDigest.toString('hex') !== specDigest) {
    throw new Error('prior_record_binding_invalid')
  }
  return row.operationKey
}

function recordBindings(plan: EffectsPlan) {
  return [
    ...(plan.locations ?? []).map((binding) => ({
      ...binding,
      kind: 'location' as const,
      key: locationCreateKey(binding.draftId),
    })),
    ...(plan.companies ?? []).map((binding) => ({
      ...binding,
      kind: 'company' as const,
      key: companyCreateKey(binding.draftId),
    })),
  ]
}

/** Every record binding keeps its identity row; a reuse still names its original create. */
async function requireRecordIdentities(
  client: Pool | PoolClient,
  runId: string,
  plan: EffectsPlan,
) {
  for (const binding of recordBindings(plan)) {
    if (binding.prior) {
      await requirePriorRecordIdentity(
        client,
        plan,
        binding.draftId,
        binding.specDigest,
        binding.prior,
      )
      continue
    }
    const rows = await executeDatabaseQuery(
      queryDatabase(client)
        .select({
          runId: recordIdentities.runId,
          kind: recordIdentities.kind,
          operationKey: recordIdentities.operationKey,
          specDigest: recordIdentities.specDigest,
        })
        .from(recordIdentities)
        .where(
          and(
            eq(recordIdentities.targetId, plan.targetId),
            eq(recordIdentities.originalKey, plan.originalSourceKey),
            eq(recordIdentities.draftId, binding.draftId),
          ),
        ),
    )
    const row = rows[0]
    if (
      !row ||
      row.runId !== runId ||
      row.kind !== binding.kind ||
      row.operationKey !== binding.key ||
      row.specDigest.toString('hex') !== binding.specDigest
    ) {
      throw new Error('record_identity_missing')
    }
  }
}

async function priorPlan(client: Pool | PoolClient, runId: string) {
  const approved = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ bytes: executorApprovals.planBytes, digest: executorApprovals.planDigest })
      .from(executorRuns)
      .innerJoin(executorApprovals, eq(executorApprovals.id, executorRuns.approvalId))
      .where(eq(executorRuns.id, runId)),
  )
  if (!approved[0]) {
    throw new Error('prior_record_authority_missing')
  }
  return decodeEffectsPlan(approved[0].bytes, approved[0].digest)
}
