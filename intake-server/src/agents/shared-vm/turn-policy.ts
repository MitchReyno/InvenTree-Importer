import { rename, writeFile } from 'node:fs/promises'
import type { ProcessingInputV6Dto } from '@invimport/contracts'
import { MAX_PROTECTED_HOSTS, protectedEntry } from './protected-hosts.ts'

/** Mounted read-write for the supervisor and read-only for the turn's egress proxy. */
export const TURN_POLICY_PATH = '/run/policy/policy.json'

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
 * An attempt sealed without web settings runs with public pages off.
 */
export function turnPolicy(manifest: ProcessingInputV6Dto, protectedHosts: unknown): TurnPolicy {
  if (!validProtectedHosts(protectedHosts)) {
    throw new Error('invalid_turn')
  }
  return {
    version: 1,
    public_pages: manifest.web?.public_pages === true,
    protected_hosts: protectedHosts,
  }
}

/** Replaces the policy in one rename, so the egress never reads a partial file. */
export async function writeTurnPolicy(path: string, policy: TurnPolicy) {
  const temporary = path + '.tmp'
  await writeFile(temporary, JSON.stringify(policy), { mode: 0o600 })
  await rename(temporary, path)
}
