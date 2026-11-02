import { inArray } from 'drizzle-orm'
import { canonical } from '@invimport/contracts/json'
import { executeDatabaseQuery, queryDatabase } from '../db/database.ts'
import { inventoryTransport } from '../inventory/transport.ts'
import type { ApplyDependencies } from './apply.ts'
import { applyAttachments } from './attachment-apply.ts'
import type { AttachmentRecovery } from './attachment-recovery.ts'
import { lockRun, snapshot } from './authority.ts'
import { supportedCreateBody } from './effects-body.ts'
import { fieldsMatch } from './effects-evidence.ts'
import {
  recordSupportedAssessment,
  type SupportedJournalContext,
  type SupportedRecovery,
} from './effects-journal.ts'
import { cataloguePreconditionsComplete } from './effects-preconditions.ts'
import { performSupportedRequest } from './effects-request.ts'
import type { EffectsPlan } from './effects-plan.ts'
import { supportedStates, type SupportedState } from './effects-state.ts'
import type { EffectStep } from './effects-step.ts'
import { effectStepKey, effectStepKind } from './effects-step.ts'
import { applyPartAttachmentEffect } from './part-attachment-apply.ts'
import { responseObject, responsePk } from './response.ts'
import { supportedRecoveries } from './schema.ts'
import { executorTransaction } from './transaction.ts'

export { attributedPks, supportedResponseEvidence } from './effects-evidence.ts'

export async function applySupportedEffects(
  deps: ApplyDependencies,
  runId: string,
  plan: EffectsPlan,
  recoveryIds: readonly string[],
  health: () => Promise<void>,
) {
  if (deps.profile.effectsCapability !== plan.capability) {
    throw new Error('effects_apply_capability_unavailable')
  }
  const transport = inventoryTransport(deps.profile)
  const selected = await selectedRecoveries(deps, recoveryIds)
  const attachmentRecoveries = (
    await deps.pool.query<AttachmentRecovery>(
      'SELECT * FROM executor_attachment_recovery WHERE id=ANY($1::uuid[])',
      [recoveryIds],
    )
  ).rows
  const selectedRunIds = [
    ...selected.map((row) => row.runId),
    ...attachmentRecoveries.map((row) => row.run_id),
  ]
  if (
    selectedRunIds.length !== recoveryIds.length ||
    selectedRunIds.some((selectedRunId) => selectedRunId !== runId)
  ) {
    throw new Error('recovery_scope_mismatch')
  }
  const context: SupportedJournalContext = { pool: deps.pool, runId, plan, health }
  for (const step of [...plan.effects, ...plan.operations] as EffectStep[]) {
    const recovery = selected.find((row) => row.operationKey === effectStepKey(step))
    if (recoveryIds.length && !recovery) {
      continue
    }
    const states = await supportedStates(deps.pool, runId, plan)
    const current = states.find((state) => state.operationKey === effectStepKey(step))!
    const body = await supportedCreateBody(deps.pool, runId, plan, step)
    if (!body) {
      continue
    }
    const kind = effectStepKind(step)
    if (kind === 'part_attachment' && 'kind' in step) {
      const next = await applyPartAttachmentEffect(
        deps,
        context,
        transport,
        step,
        body,
        recovery,
        current,
        states,
      )
      if (next === 'stop') {
        break
      }
      continue
    }
    if (recovery?.kind === 'verify_effect') {
      await inspectKnownEffect(deps, context, transport, step, body, recovery, current, kind)
      continue
    }
    if (current.certainty === 'confirmed') {
      continue
    }
    if (current.certainty === 'unknown' || states.some((state) => state.certainty === 'unknown')) {
      break
    }
    const complete = await cataloguePreconditionsComplete(
      deps,
      context,
      transport,
      step,
      body,
      recovery,
    )
    if (!complete) {
      break
    }
    await performSupportedRequest(
      deps,
      context,
      step,
      'create',
      { kind, body },
      () => transport.sendSupported(plan, kind, canonical(body)),
      recovery,
    )
  }
  await applyAttachments(
    deps,
    runId,
    transport,
    attachmentRecoveries,
    recoveryIds.length > 0,
    health,
  )
  return executorTransaction(deps.pool, async (client) => {
    await lockRun(client, runId)
    const result = await snapshot(client, runId)
    if (result.state === 'settled_complete' || result.state === 'settled_incomplete') {
      await client.query(
        'UPDATE executor_guard SET active_run=NULL WHERE target_id=$1 AND original_key=$2 AND active_run=$3',
        [plan.targetId, plan.originalSourceKey, runId],
      )
    }
    return result
  })
}

async function selectedRecoveries(deps: ApplyDependencies, recoveryIds: readonly string[]) {
  return executeDatabaseQuery(
    queryDatabase(deps.pool)
      .select()
      .from(supportedRecoveries)
      .where(inArray(supportedRecoveries.id, [...recoveryIds])),
  )
}

async function inspectKnownEffect(
  deps: ApplyDependencies,
  context: SupportedJournalContext,
  transport: ReturnType<typeof inventoryTransport>,
  step: EffectStep,
  body: Record<string, string | string[] | null | boolean>,
  recovery: SupportedRecovery,
  current: SupportedState,
  kind: ReturnType<typeof effectStepKind>,
) {
  if (current.remotePks.length !== 1 || !current.createIntentId) {
    throw new Error('unattributed_effect_not_verifiable')
  }
  const remotePk = current.remotePks[0]
  const createIntentId = current.createIntentId
  const result = await performSupportedRequest(
    deps,
    context,
    step,
    'verify',
    { kind, pk: remotePk },
    () => transport.readSupported(context.plan, kind, remotePk),
    recovery,
  )
  if (!result) {
    return
  }
  let outcome: 'matches' | 'missing_or_changed' | 'unavailable' = 'unavailable'
  try {
    outcome =
      result.status === 200 &&
      responsePk(responseObject(result.bytes).pk) === remotePk &&
      fieldsMatch(responseObject(result.bytes), body)
        ? 'matches'
        : result.status === 404 || result.status === 200
          ? 'missing_or_changed'
          : 'unavailable'
  } catch {
    outcome = 'unavailable'
  }
  await recordSupportedAssessment(
    deps.pool,
    context.runId,
    effectStepKey(step),
    result.intentId,
    createIntentId,
    outcome,
    remotePk,
  )
}
