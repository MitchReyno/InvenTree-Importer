import { rename, writeFile } from 'node:fs/promises'
import type { ProcessingInputV6Dto } from '@invimport/contracts'
import { MAX_PROTECTED_HOSTS, protectedEntry } from './protected-hosts.ts'

/** Mounted read-write for the supervisor and read-only for the turn's egress proxy. */
export const TURN_POLICY_PATH = '/run/policy/policy.json'

/** The egress proxy ignores a larger file, so a larger policy is refused before it is written. */
export const MAX_TURN_POLICY_BYTES = 16384

/** Profiles whose sealed web setting may open public pages. */
const WEB_ACCESS_PROFILES: ReadonlySet<string> = new Set(['shared-vm-agent/3'])

/** What the guest egress proxy allows for one tool turn; version 1 of its file format. */
export interface TurnPolicy {
  version: 1
  public_pages: boolean
  protected_hosts: string[]
}

function validProtectedHosts(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_PROTECTED_HOSTS &&
    value.every((entry) => protectedEntry(entry))
  )
}

/**
 * The policy for a tool turn from its sealed manifest and the coordinator's protected hosts.
 * Public pages need both a profile with web access and a sealed setting that turns them on;
 * an attempt sealed without web settings runs with them off.
 */
export function turnPolicy(manifest: ProcessingInputV6Dto, protectedHosts: unknown): TurnPolicy {
  if (!validProtectedHosts(protectedHosts)) {
    throw new Error('invalid_turn')
  }
  const webProfile = WEB_ACCESS_PROFILES.has(manifest.profile_id)
  const policy: TurnPolicy = {
    version: 1,
    public_pages: webProfile && manifest.web?.public_pages === true,
    protected_hosts: protectedHosts,
  }
  if (Buffer.byteLength(JSON.stringify(policy)) > MAX_TURN_POLICY_BYTES) {
    throw new Error('invalid_turn')
  }
  return policy
}

/** Replaces the policy in one rename, so the egress never reads a partial file. */
export async function writeTurnPolicy(path: string, policy: TurnPolicy) {
  const temporary = path + '.tmp'
  await writeFile(temporary, JSON.stringify(policy), { mode: 0o600 })
  await rename(temporary, path)
}
