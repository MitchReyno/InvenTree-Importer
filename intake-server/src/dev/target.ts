import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'

export const LOCAL_INVENTREE = {
  kind: 'local-inventree',
  origin: 'http://127.0.0.1:4320',
  credentialRef: 'local_inventree_dev',
} as const

export type DevelopmentTarget =
  | { kind: 'fake' }
  | {
      kind: 'read-only'
      origin: string
      credentialRef: string
    }
  | {
      kind: 'local-inventree'
      origin: typeof LOCAL_INVENTREE.origin
      credentialRef: typeof LOCAL_INVENTREE.credentialRef
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
  if (kind === 'local-inventree') {
    // The local stack owns its origin, key and database server; nothing may redirect them.
    if (
      supplied ||
      env.INTAKE_DEV_API_KEY !== undefined ||
      env.INTAKE_DEV_ADMIN_URL !== undefined
    ) {
      throw new Error('conflicting_development_target_settings')
    }
    return { ...LOCAL_INVENTREE }
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
  if (target.kind !== 'read-only') {
    // Fake uses its owned token; local-inventree reads its key from private state.
    return undefined
  }
  const key = env.INTAKE_DEV_API_KEY
  if (!key?.trim() || key.length > 8192 || /[^\x21-\x7e]/.test(key)) {
    throw new Error('development_read_key_required')
  }
  return key
}

/** What a default namespace is bound to besides the target: its database server. */
export interface StateScope {
  serverId: string
  /** The local InvenTree instance; a reset gives it a new ID. */
  instanceId?: string
}

/** Default namespaces are scoped to the database server, so a new server gets fresh app state. */
export function developmentStateRoot(
  env: NodeJS.ProcessEnv,
  target: DevelopmentTarget,
  scope: StateScope,
): string {
  if (env.INTAKE_APP_STATE !== undefined) {
    return resolve(env.INTAKE_APP_STATE)
  }
  if (!/^[a-f0-9]{32}$/.test(scope.serverId)) {
    throw new Error('development_server_identity_required')
  }
  if (target.kind === 'fake') {
    return join(homedir(), '.local/state/bench-intake', `app-${scope.serverId.slice(0, 16)}`)
  }
  if (target.kind === 'local-inventree' && !/^[a-f0-9]{32}$/.test(scope.instanceId ?? '')) {
    throw new Error('local_inventree_instance_required')
  }
  const binding =
    target.kind === 'local-inventree'
      ? { target, serverId: scope.serverId, instanceId: scope.instanceId }
      : { target, serverId: scope.serverId }
  const digest = createHash('sha256').update(JSON.stringify(binding)).digest('hex').slice(0, 32)
  return join(homedir(), '.local/state/bench-intake', `${target.kind}-${digest}`)
}
