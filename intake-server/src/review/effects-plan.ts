import { isEffectsPlan } from '../execution/effects-plan.ts'
import { partTransferEffects, type PartTransfer } from '../execution/part-attachment-plan.ts'
import { effectsManifestDigestFor } from '../execution/effects-capability.ts'
import { and, eq } from 'drizzle-orm'
import type { PoolClient } from 'pg'
import { executeDatabaseQuery, queryDatabase } from '../db/database.ts'
import { partIdentities, recordIdentities } from '../execution/schema.ts'
import { fail } from '../capture/model.ts'
import {
  EFFECTS_VERSIONS,
  RECORD_EFFECTS_CAPABILITY,
  companyCreateKey,
  locationCreateKey,
  recordEffects,
  recordSpecDigest,
  type CompanyBinding,
  type LocationBinding,
  type RecordPrior,
  logicalEffectKey,
  partSpecDigest,
  partEffects,
  type EffectsPlan,
  type PartBinding,
} from '../execution/effects-plan.ts'
import type { EffectsDeployment } from '../execution/effects-source.ts'
import { supportedStates } from '../execution/effects-state.ts'
import { loadRun } from '../execution/authority.ts'
import {
  evidenceVersion,
  retainedEvidence,
  mediaManifestDigest,
  selectedAttachments,
} from './media-plan.ts'
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

export interface RecordBindings {
  locations: LocationBinding[]
  companies: CompanyBinding[]
}

/** A draft already created by an earlier run of this source reuses that exact confirmed output. */
export async function knownRecordBindings(
  client: PoolClient,
  source: { targetId: string; originalSourceKey: string },
  material: ManualMaterial,
): Promise<RecordBindings> {
  async function prior(draftId: string, operationKey: string, specDigest: string) {
    const retained = (
      await executeDatabaseQuery(
        queryDatabase(client)
          .select()
          .from(recordIdentities)
          .where(
            and(
              eq(recordIdentities.targetId, source.targetId),
              eq(recordIdentities.originalKey, source.originalSourceKey),
              eq(recordIdentities.draftId, draftId),
            ),
          ),
      )
    )[0]
    if (!retained) {
      return null
    }
    if (
      retained.specDigest.toString('hex') !== specDigest ||
      retained.operationKey !== operationKey
    ) {
      fail('prior_record_spec_changed', 409)
    }
    const authority = await loadRun(client, retained.runId)
    if (!isEffectsPlan(authority.plan)) {
      fail('prior_record_authority_invalid', 409)
    }
    const state = (await supportedStates(client, retained.runId, authority.plan)).find(
      (item) => item.operationKey === operationKey,
    )
    if (
      state?.certainty !== 'confirmed' ||
      state.verification === 'missing_or_changed' ||
      state.verification === 'unavailable' ||
      state.remotePks.length !== 1 ||
      !state.createIntentId
    ) {
      fail('prior_record_unconfirmed', 409)
    }
    return {
      runId: retained.runId,
      intentId: state.createIntentId,
      pk: state.remotePks[0],
    } satisfies RecordPrior
  }

  const locations: LocationBinding[] = []
  for (const location of material.locations ?? []) {
    const specDigest = recordSpecDigest(location.spec)
    locations.push({
      draftId: location.draftId,
      spec: location.spec,
      specDigest,
      prior: await prior(location.draftId, locationCreateKey(location.draftId), specDigest),
    })
  }
  const companies: CompanyBinding[] = []
  for (const company of material.companies ?? []) {
    const versions = company.logoVersions ?? []
    const spec = {
      ...company.spec,
      logo: versions.length ? evidenceVersion(versions[0], versions) : null,
    }
    const specDigest = recordSpecDigest(spec)
    companies.push({
      draftId: company.draftId,
      spec,
      specDigest,
      prior: await prior(company.draftId, companyCreateKey(company.draftId), specDigest),
    })
  }
  return { locations, companies }
}

export function supportedPlan(
  binding: EffectsDeployment,
  sourceId: string,
  originalSourceKey: string,
  material: ManualMaterial,
  parts: PartBinding[],
  partAttachments: PartTransfer[],
  records: RecordBindings = { locations: [], companies: [] },
): EffectsPlan {
  const recordPlan = binding.capability === RECORD_EFFECTS_CAPABILITY
  const version = recordPlan ? 'bench-effects-plan/2' : 'bench-effects-plan/1'
  const effects = [
    ...(recordPlan ? recordEffects(records.locations, records.companies) : []),
    ...parts.flatMap(partEffects),
    ...partTransferEffects(partAttachments),
  ]
  const evidence = retainedEvidence(
    material.mediaInputs ?? new Map(),
    (recordPlan ? (material.companies ?? []) : []).flatMap((company) => company.logoVersions ?? []),
  )
  return {
    version,
    build: EFFECTS_VERSIONS[version].build,
    capability: EFFECTS_VERSIONS[version].capability,
    deploymentId: binding.deploymentId,
    targetId: binding.targetId,
    contextId: binding.contextId,
    epoch: binding.epoch,
    continuity: binding.continuity,
    sourceId,
    originalSourceKey,
    mediaConfigured: material.mediaConfigured === true,
    manifestDigest: effectsManifestDigestFor(version),
    parts,
    partAttachments,
    effects,
    operations: material.effects.map((effect) => {
      const part = parts.find(
        (part) =>
          logicalEffectKey(part.subjectId, 'create_part') ===
          ('part_operation_key' in effect ? effect.part_operation_key : null),
      )
      const draft = records.locations.find(
        (location) => locationCreateKey(location.draftId) === effect.location_operation_key,
      )
      return {
        operationKey: effect.lot_id,
        contributionKey: effect.contribution_key,
        part: effect.part_id ?? part?.prior?.pk ?? null,
        partOperationKey:
          effect.part_id === null && !part?.prior ? effect.part_operation_key : null,
        location: effect.location_id ?? draft?.prior?.pk ?? null,
        ...(recordPlan
          ? { locationOperationKey: draft && !draft.prior ? effect.location_operation_key! : null }
          : {}),
        quantity: effect.quantity,
        barcode: effect.barcode,
      }
    }),
    ...(recordPlan ? { locations: records.locations, companies: records.companies } : {}),
    evidence,
    attachments: selectedAttachments(material, evidence),
    mediaInputsDigest: mediaManifestDigest(material.mediaInputs ?? new Map()),
  }
}
