import { Bootstrap, validate, type BootstrapDto } from '@invimport/contracts'

export interface DevConfig {
  origin: string
  actorId: string
  targetId: string
  targetContextId: string
  credentialRef: string
  apiKey?: string
}

/** Explicit injected server configuration only. Never discovers or loads a .env. */
export function devConfig(env: NodeJS.ProcessEnv): DevConfig {
  const config = {
    origin: env.INTAKE_ORIGIN ?? 'http://127.0.0.1:4310',
    actorId: env.INTAKE_ACTOR_ID ?? '00000000-0000-4000-8000-000000000001',
    targetId: env.INTAKE_TARGET_ID ?? '00000000-0000-4000-8000-000000000002',
    targetContextId: env.INTAKE_TARGET_CONTEXT_ID ?? '00000000-0000-4000-8000-000000000003',
    credentialRef: env.INTAKE_CREDENTIAL_REF ?? 'unconfigured',
    apiKey: env.INTAKE_DEV_API_KEY,
  }
  const url = new URL(config.origin)
  if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:' || url.origin !== config.origin) throw new Error('loopback_origin_required')
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(config.credentialRef)) throw new Error('invalid_credential_reference')
  validate('Bootstrap', bootstrap(config))
  return Object.freeze(config)
}

export function bootstrap(config: DevConfig, csrfToken: string | null = null): BootstrapDto {
  return {
    mode: Bootstrap.properties.mode.const,
    banner: Bootstrap.properties.banner.const,
    status: config.apiKey?.trim() && config.credentialRef !== 'unconfigured' ? 'configured' : 'setup_required',
    actor_id: config.actorId,
    target_id: config.targetId,
    target_context_id: config.targetContextId,
    mutation_enabled: false,
    permission_gate: 'deferred_T11',
    csrf_token: csrfToken,
  }
}
