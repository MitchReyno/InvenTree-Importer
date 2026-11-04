import { isEffectsPlan } from '../execution/effects-plan.ts'
import { partTransferEffects, type PartTransfer } from '../execution/part-attachment-plan.ts'
import { SUPPORTED_EFFECTS_MANIFEST } from '../execution/effects-capability.ts'
import { sha256 } from '../db/authority.ts'
import { canonical } from '@invimport/contracts/json'
import { and, eq } from 'drizzle-orm'
import type { PoolClient } from 'pg'
import { executeDatabaseQuery, queryDatabase } from '../db/database.ts'
import { partIdentities } from '../execution/schema.ts'
import { fail } from '../capture/repository.ts'
import {
  EFFECTS_BUILD,
  EFFECTS_CAPABILITY,
  logicalEffectKey,
  partSpecDigest,
  partEffects,
  type EffectsPlan,
  type PartBinding,
} from '../execution/effects-plan.ts'
import type { EffectsDeployment } from '../execution/effects-source.ts'
import { supportedStates } from '../execution/effects-state.ts'
import { loadRun } from '../execution/authority.ts'
import { retainedEvidence, mediaManifestDigest, selectedAttachments } from './media-plan.ts'
import type { ManualMaterial } from './model.ts'

/** Retained source/subject identity is authoritative even when the remote Part has disappeared. */
export async function knownPartBindings(
  client: PoolClient,
  source: { targetId: string; originalSourceKey: string },
  material: ManualMaterial,
) {
  const parts: PartBinding[] = []
  for (const part of material.parts) {
    const specDigest = partSpecDigest(part.spec)
    const retained = await executeDatabaseQuery(
      queryDatabase(client)
        .select()
        .from(partIdentities)
        .where(
          and(
            eq(partIdentities.targetId, source.targetId),
            eq(partIdentities.originalKey, source.originalSourceKey),
            eq(partIdentities.partSubjectId, part.subjectId),
          ),
        ),
    )
    const prior = retained[0]
    if (!prior) {
      parts.push({ ...part, specDigest, prior: null })
      continue
    }
    if (prior.specDigest.toString('hex') !== specDigest) {
      fail('prior_part_spec_changed', 409)
    }
    const authority = await loadRun(client, prior.runId)
    if (!isEffectsPlan(authority.plan)) {
      fail('prior_part_authority_invalid', 409)
    }
    const state = (await supportedStates(client, prior.runId, authority.plan)).find(
      (item) => item.operationKey === prior.operationKey,
    )
    if (
      state?.certainty !== 'confirmed' ||
      state.verification === 'missing_or_changed' ||
      state.verification === 'unavailable' ||
      state.remotePks.length !== 1 ||
      !state.createIntentId
    ) {
      fail('prior_part_unconfirmed', 409)
    }
    parts.push({
      ...part,
      specDigest,
      prior: { runId: prior.runId, intentId: state.createIntentId, pk: state.remotePks[0] },
    })
  }
  return parts
}

export function supportedPlan(
  binding: EffectsDeployment,
  sourceId: string,
  originalSourceKey: string,
  material: ManualMaterial,
  parts: PartBinding[],
  partAttachments: PartTransfer[],
): EffectsPlan {
  const effects = [...parts.flatMap(partEffects), ...partTransferEffects(partAttachments)]
  const evidence = retainedEvidence(material.mediaInputs ?? new Map())
  return {
    version: 'bench-effects-plan/1',
    build: EFFECTS_BUILD,
    capability: EFFECTS_CAPABILITY,
    deploymentId: binding.deploymentId,
    targetId: binding.targetId,
    contextId: binding.contextId,
    epoch: binding.epoch,
    continuity: binding.continuity,
    sourceId,
    originalSourceKey,
    mediaConfigured: material.mediaConfigured === true,
    manifestDigest: sha256(canonical(SUPPORTED_EFFECTS_MANIFEST)).toString('hex'),
    parts,
    partAttachments,
    effects,
    operations: material.effects.map((effect) => {
      const part = parts.find(
        (part) =>
          logicalEffectKey(part.subjectId, 'create_part') ===
          ('part_operation_key' in effect ? effect.part_operation_key : null),
      )
      return {
        operationKey: effect.lot_id,
        contributionKey: effect.contribution_key,
        part: effect.part_id ?? part?.prior?.pk ?? null,
        partOperationKey:
          effect.part_id === null && !part?.prior ? effect.part_operation_key : null,
        location: effect.location_id,
        quantity: effect.quantity,
        barcode: effect.barcode,
      }
    }),
    evidence,
    attachments: selectedAttachments(material, evidence),
    mediaInputsDigest: mediaManifestDigest(material.mediaInputs ?? new Map()),
  }
}
