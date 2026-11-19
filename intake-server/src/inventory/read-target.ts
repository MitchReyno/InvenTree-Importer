import { bootstrap, type DevConfig } from '#/config.ts'
import { CredentialHolder, type SavedCredential } from './credential.ts'
import type { CredentialBinding } from './credential-store.ts'
import { inventoryTransport, type TargetProfile } from './transport.ts'

/** The protected read target, with the token it reads with and a way to try another. */
export interface ReadTarget {
  binding: CredentialBinding
  holder: CredentialHolder
  transport: ReturnType<typeof inventoryTransport>
  /** Sends the connection probe with a candidate token; the token in use is untouched. */
  probeWith: (token: string) => Promise<Response>
}

/**
 * Which InvenTree and target context a saved token belongs to, when this process has a
 * configured read target at all. Bootstrap's status stays the injected key's alone.
 */
export function readTargetBinding(
  config: DevConfig,
  readOrigin: string | undefined,
): CredentialBinding | undefined {
  if (!readOrigin || !config.apiKey || bootstrap(config).status !== 'configured') {
    return undefined
  }
  return { origin: new URL(readOrigin).origin, targetContextId: config.targetContextId }
}

/** Builds the read transport over the environment token, or a saved one for this target. */
export function configureReadTarget(
  config: DevConfig,
  readOrigin: string | undefined,
  saved: SavedCredential | null,
): ReadTarget | undefined {
  const binding = readTargetBinding(config, readOrigin)
  if (!binding || !readOrigin || !config.apiKey) {
    return undefined
  }
  const profile: TargetProfile = {
    kind: 'protected-read-only',
    origin: readOrigin,
    targetId: config.targetId,
    contextId: config.targetContextId,
    protectedOrigins: [readOrigin],
    credential: config.apiKey,
  }
  const target = { targetId: config.targetId, contextId: config.targetContextId }
  const holder = new CredentialHolder(config.apiKey, saved)
  return {
    binding,
    holder,
    transport: inventoryTransport(profile, undefined, () => holder.current()),
    // A one-off transport for the candidate, so a refused token never reaches the holder.
    probeWith: (token) => inventoryTransport({ ...profile, credential: token }).probe(target),
  }
}
