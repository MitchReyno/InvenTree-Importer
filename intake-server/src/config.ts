import { Bootstrap, validate, type BootstrapDto } from '@invimport/contracts'
import { strictJson } from '@invimport/contracts/json'
import type { ProcessingConfig } from './processing/attempts.ts'
import { canonicalSourceUrl } from './research/source-policy.ts'
import {
  MAX_RESEARCH_PROTECTED_ORIGINS,
  MAX_RESEARCH_SOURCE_URLS,
  MAX_RESEARCH_URL_BYTES,
} from './research/limits.ts'

export interface DevConfig {
  origin: string
  actorId: string
  targetId: string
  targetContextId: string
  credentialRef: string
  apiKey?: string
  /** The owned test fake in development, otherwise a configured InvenTree. */
  targetKind?: 'owned_test' | 'configured'
}

export interface RuntimeFeatures {
  mediaEnabled: boolean
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
    targetKind:
      env.INTAKE_TARGET_PROFILE === 'fake' ? ('owned_test' as const) : ('configured' as const),
  }
  const url = new URL(config.origin)
  if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:' || url.origin !== config.origin) {
    throw new Error('loopback_origin_required')
  }
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(config.credentialRef)) {
    throw new Error('invalid_credential_reference')
  }
  validate('Bootstrap', bootstrap(config))
  return Object.freeze(config)
}

export function bootstrap(
  config: DevConfig,
  csrfToken: string | null = null,
  features: RuntimeFeatures = { mediaEnabled: false },
): BootstrapDto {
  return {
    mode: Bootstrap.properties.mode.const,
    banner: Bootstrap.properties.banner.const,
    status:
      config.apiKey?.trim() && config.credentialRef !== 'unconfigured'
        ? 'configured'
        : 'setup_required',
    actor_id: config.actorId,
    target_id: config.targetId,
    target_context_id: config.targetContextId,
    mutation_enabled: false,
    media_enabled: features.mediaEnabled,
    permission_gate: 'deferred_T11',
    csrf_token: csrfToken,
  }
}

const MAX_RESEARCH_CONFIGURATION_BYTES = 64 * 1024

function researchUrlList(raw: string | undefined, maximum: number): string[] {
  if (raw === undefined) {
    return []
  }
  if (Buffer.byteLength(raw) > MAX_RESEARCH_CONFIGURATION_BYTES) {
    throw new Error('invalid_research_configuration')
  }
  const values: unknown = strictJson(raw)
  if (!Array.isArray(values) || values.length > maximum) {
    throw new Error('invalid_research_configuration')
  }
  const urls: string[] = []
  for (const value of values) {
    if (
      typeof value !== 'string' ||
      value.length === 0 ||
      Buffer.byteLength(value) > MAX_RESEARCH_URL_BYTES
    ) {
      throw new Error('invalid_research_configuration')
    }
    urls.push(value)
  }
  return urls
}

function researchProtectedOrigins(env: NodeJS.ProcessEnv): readonly string[] {
  const configured = researchUrlList(
    env.INTAKE_RESEARCH_PROTECTED_ORIGINS,
    MAX_RESEARCH_PROTECTED_ORIGINS,
  )
  if (env.INTAKE_READ_ORIGIN !== undefined) {
    configured.push(env.INTAKE_READ_ORIGIN)
  }
  const origins = new Set<string>()
  for (const value of configured) {
    let url: URL
    try {
      url = new URL(value)
    } catch {
      throw new Error('invalid_research_configuration')
    }
    const valid =
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === '/'
    if (!valid) {
      throw new Error('invalid_research_configuration')
    }
    origins.add(url.origin)
  }
  if (origins.size > MAX_RESEARCH_PROTECTED_ORIGINS) {
    throw new Error('invalid_research_configuration')
  }
  return Object.freeze([...origins].sort())
}

/** Server-only profile choice. No credential or native executable crosses this boundary. */
export function processingConfig(config: DevConfig, env: NodeJS.ProcessEnv): ProcessingConfig {
  const profileId = env.INTAKE_PROCESSING_PROFILE ?? 'synthetic-research/2'
  if (
    profileId !== 'synthetic-research/2' &&
    profileId !== 'restricted-research-stub/1' &&
    profileId !== 'native-agent/1' &&
    profileId !== 'native-agent/2' &&
    profileId !== 'shared-vm-agent/1' &&
    profileId !== 'shared-vm-agent/2' &&
    profileId !== 'synthetic-session/1'
  ) {
    throw new Error('unsupported_processing_profile')
  }
  const approved = researchUrlList(env.INTAKE_RESEARCH_SOURCE_URLS, MAX_RESEARCH_SOURCE_URLS)
  const canonicalUrls = approved.map((value) => canonicalSourceUrl(value).href)
  return Object.freeze({
    actorId: config.actorId,
    targetId: config.targetId,
    targetContextId: config.targetContextId,
    channelSecret: env.INTAKE_PROCESSING_CHANNEL_SECRET ?? '',
    profileId,
    approvedSourceUrls: Object.freeze([...new Set(canonicalUrls)].sort()),
    sourceProtectedOrigins: researchProtectedOrigins(env),
  })
}
