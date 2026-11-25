import type { PoolClient } from 'pg'
import { STAGE_TOOL_PROFILE, type BriefStageDto } from '@invimport/contracts'
import type { ProcessingConfig } from './attempts.ts'
import { unseal } from './model.ts'
import { sessionProfiles, type SessionProfileId } from './session-policy.ts'

export { STAGE_TOOL_PROFILE }

/** The session input versions a batch's pipeline can follow. */
export type SessionInputVersion = 'bench-intake-input/6' | 'bench-intake-input/7'

/**
 * Each stage pack's digest by profile, as migrations `0039` and `0043` store them. A `/7` input
 * seals its stage's, and the claim checks the stored pack against it. Earlier profiles have none.
 */
export const stagePacks: Partial<Record<SessionProfileId, Record<BriefStageDto, string>>> = {
  'synthetic-session/1': {
    examine: '5daef10b9d90164451003879c982e8a736206b01b1440465a493cb2128726a19',
    research: 'b1c4f826f3cbc86ccd900365f6a72a570db98ded905ef2ec53a971b60547bec9',
    images: 'e4cfa08e54a09b24d895529b36493784e55bff9865fe9b4ec3cfc5caad2b4580',
  },
  'shared-vm-agent/4': {
    examine: '9427272cfc1759207247eb6cc799a94d95d7c8754302ed85ae0040497944be4a',
    research: '676bfcfa1e91befc223702c72c74230533f177be7c325474dbf2ba0360d97b73',
    images: '1266b1d819acb73ceddb251f18acd7886d94b61773f5ed54d6206e67e94b397b',
  },
}

/** Profiles that run only the `/7` pipeline; they never seal a `/6` input. */
export function stageOnlyProfile(profileId: string) {
  return profileId === 'shared-vm-agent/4'
}

/**
 * The tool profile a session input may seal: the profile's own for `/6`, and the stage tool
 * profile for `/7`. The claim checks the sealed one against this, not one fixed per profile.
 */
export function expectedToolProfile(profileId: SessionProfileId, version: SessionInputVersion) {
  return version === 'bench-intake-input/7'
    ? STAGE_TOOL_PROFILE
    : sessionProfiles[profileId].toolProfileVersion
}

/**
 * The version a batch with no lead follows: `/7` only under the test-only switch, for
 * `synthetic-session/1` on its local route or the stage profile `shared-vm-agent/4`, which
 * configuration can't select yet. Every other configuration keeps `/6`.
 */
export function configuredInputVersion(
  config: Pick<ProcessingConfig, 'profileId' | 'stageInputs'>,
): SessionInputVersion {
  const stageProfile =
    config.profileId === 'synthetic-session/1' || config.profileId === 'shared-vm-agent/4'
  return stageProfile && config.stageInputs === 'local'
    ? 'bench-intake-input/7'
    : 'bench-intake-input/6'
}

/** The sealed input version of the batch's Examine lead, or null when it has none. */
export async function leadInputVersion(
  client: PoolClient,
  batchId: string,
): Promise<SessionInputVersion | null> {
  const rows = await client.query<{ manifest_bytes: Buffer; manifest_digest: Buffer }>(
    `SELECT i.manifest_bytes,i.manifest_digest FROM public.processing_job j
     JOIN public.processing_attempt a ON a.id=j.current_attempt_id
     JOIN public.processing_input i ON i.id=a.input_id
     WHERE j.batch_id=$1 AND j.stage='examine'`,
    [batchId],
  )
  const lead = rows.rows[0]
  if (!lead) {
    return null
  }
  const sealed = unseal(lead.manifest_bytes, lead.manifest_digest) as { schema_version?: unknown }
  return sealed.schema_version === 'bench-intake-input/7'
    ? 'bench-intake-input/7'
    : 'bench-intake-input/6'
}

/**
 * The version every queueing entry point seals for this batch: its lead's, so a retained `/6`
 * lead never gets `/7` successors, or the configuration's when the batch has no lead yet.
 */
export async function batchInputVersion(
  client: PoolClient,
  config: Pick<ProcessingConfig, 'profileId' | 'stageInputs'>,
  batchId: string,
): Promise<SessionInputVersion> {
  return (await leadInputVersion(client, batchId)) ?? configuredInputVersion(config)
}
