import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'

export type DevelopmentTarget =
  | { kind: 'fake' }
  | {
      kind: 'read-only'
      origin: string
      credentialRef: string
    }

export function developmentTarget(env: NodeJS.ProcessEnv): DevelopmentTarget {
  const supplied = env.INTAKE_READ_ORIGIN !== undefined || env.INTAKE_CREDENTIAL_REF !== undefined
  const kind = env.INTAKE_TARGET_PROFILE ?? (supplied ? 'read-only' : 'fake')
  if (kind === 'fake') {
    if (supplied || env.INTAKE_DEV_API_KEY !== undefined) {
      throw new Error('conflicting_development_target_settings')
    }
    return { kind }
  }
  if (kind !== 'read-only') {
    throw new Error('unsupported_development_target')
  }
  const address = env.INTAKE_READ_ORIGIN
  const credentialRef = env.INTAKE_CREDENTIAL_REF
  if (
    !address ||
    address.length > 2048 ||
    /\s/.test(address) ||
    !credentialRef ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(credentialRef)
  ) {
    throw new Error('development_read_target_required')
  }
  let url: URL
  try {
    url = new URL(address)
  } catch {
    throw new Error('invalid_development_target_origin')
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new Error('invalid_development_target_origin')
  }
  return { kind, origin: url.origin, credentialRef }
}

export function developmentCredential(
  env: NodeJS.ProcessEnv,
  target: DevelopmentTarget,
): string | undefined {
  if (target.kind === 'fake') {
    return undefined
  }
  const key = env.INTAKE_DEV_API_KEY
  if (!key?.trim() || key.length > 8192 || /[^\x21-\x7e]/.test(key)) {
    throw new Error('development_read_key_required')
  }
  return key
}

export function developmentStateRoot(env: NodeJS.ProcessEnv, target: DevelopmentTarget): string {
  if (env.INTAKE_APP_STATE !== undefined) {
    return resolve(env.INTAKE_APP_STATE)
  }
  if (target.kind === 'fake') {
    return join(homedir(), '.local/state/bench-intake/app')
  }
  const digest = createHash('sha256').update(JSON.stringify(target)).digest('hex').slice(0, 32)
  return join(homedir(), '.local/state/bench-intake', `read-only-${digest}`)
}
