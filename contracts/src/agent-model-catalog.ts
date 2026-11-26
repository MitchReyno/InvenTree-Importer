import { Type, type Static, type TProperties } from '@sinclair/typebox'
import { AgentEffort, AgentSelection } from './agent-selection.ts'

const object = <T extends TProperties>(properties: T) =>
  Type.Object(properties, { additionalProperties: false })

/** Most models one provider's list may hold. */
export const MAX_CATALOG_MODELS = 200
/** Longest model name kept. */
export const MAX_CATALOG_NAME_LENGTH = 80
/** Most effort levels one model may list. */
export const MAX_CATALOG_EFFORTS = 12
/** Largest stored list, as canonical JSON bytes. */
export const MAX_CATALOG_BYTES = 64 * 1024

/**
 * One model a provider offers. `older` puts a Claude model in the collapsed group; `default` is the
 * provider's own default; `efforts` are the levels it accepts, in the provider's order, and empty
 * when it takes none; `usable` is whether an API key may use it, null when nothing marked it.
 */
export const AgentCatalogModel = object({
  id: AgentSelection.properties.model,
  name: Type.String({ minLength: 1, maxLength: MAX_CATALOG_NAME_LENGTH }),
  older: Type.Boolean(),
  default: Type.Boolean(),
  efforts: Type.Array(AgentEffort, { maxItems: MAX_CATALOG_EFFORTS }),
  default_effort: Type.Union([AgentEffort, Type.Null()]),
  usable: Type.Union([Type.Boolean(), Type.Null()]),
})
export const AgentCatalogModels = Type.Array(AgentCatalogModel, { maxItems: MAX_CATALOG_MODELS })

/** Why the last read failed; a fixed code, never the provider's text. */
export const CATALOG_FAILURES = [
  'timeout',
  'guest_outdated',
  'vm_unreachable',
  'signed_out',
  'malformed',
  'unavailable',
] as const

/**
 * `current`: the list was read under the current sign-in. `reading`: a read is requested or
 * running. `failed`: the last read failed; the list is the last good one. `stale_sign_in`: the
 * list is from an earlier sign-in, so nothing should be warned about from it. `never_read`: no
 * list is stored, and `models` is the built-in list.
 */
export const CATALOG_STATES = [
  'current',
  'reading',
  'failed',
  'stale_sign_in',
  'never_read',
] as const

const time = Type.String({ maxLength: 40 })
const nullableTime = Type.Union([time, Type.Null()])

export const AgentProviderCatalog = object({
  state: Type.Union(CATALOG_STATES.map((state) => Type.Literal(state))),
  /** The provider's current authentication, which the list belongs to. */
  authentication: AgentSelection.properties.authentication,
  /** Where the stored list came from: the pinned CLI or the provider's models API. */
  source: Type.Union([Type.Literal('cli'), Type.Literal('api'), Type.Null()]),
  /** Where the read ran: the agent VM or this server's session worker. */
  read_in: Type.Union([Type.Literal('vm'), Type.Literal('host'), Type.Null()]),
  cli_version: Type.Union([
    Type.String({ pattern: '^\\d{1,4}\\.\\d{1,4}\\.\\d{1,4}$' }),
    Type.Null(),
  ]),
  /** The last successful read. */
  read_at: nullableTime,
  /** The last attempt, whatever its outcome. */
  attempted_at: nullableTime,
  failure: Type.Union([
    Type.Union(CATALOG_FAILURES.map((failure) => Type.Literal(failure))),
    Type.Null(),
  ]),
  /** True when `models` is the built-in list rather than one read from the provider. */
  builtin: Type.Boolean(),
  models: AgentCatalogModels,
})
/** Each provider's model list for its current authentication. Display data only. */
export const AgentModelCatalog = object({
  claude: AgentProviderCatalog,
  codex: AgentProviderCatalog,
})
/**
 * Asks for a read; `invalidate`, sent once a sign-in change is confirmed, also marks it stale.
 * `authentication` names the sign-in method that changed; absent, the saved one is read.
 */
export const AgentModelCatalogRefresh = object({
  provider: AgentSelection.properties.provider,
  authentication: Type.Optional(AgentSelection.properties.authentication),
  invalidate: Type.Optional(Type.Boolean()),
})
export const AgentModelCatalogRefreshReceipt = object({
  provider: AgentSelection.properties.provider,
  authentication: AgentSelection.properties.authentication,
  /** Whether the list is now marked as from an earlier sign-in. */
  stale_sign_in: Type.Boolean(),
})

export type AgentCatalogModelDto = Static<typeof AgentCatalogModel>
export type AgentCatalogFailure = (typeof CATALOG_FAILURES)[number]
export type AgentCatalogState = (typeof CATALOG_STATES)[number]
export type AgentProviderCatalogDto = Static<typeof AgentProviderCatalog>
export type AgentModelCatalogDto = Static<typeof AgentModelCatalog>
export type AgentModelCatalogRefreshDto = Static<typeof AgentModelCatalogRefresh>
export type AgentModelCatalogRefreshReceiptDto = Static<typeof AgentModelCatalogRefreshReceipt>

function builtIn(id: string, name: string, older = false, isDefault = false): AgentCatalogModelDto {
  return { id, name, older, default: isDefault, efforts: [], default_effort: null, usable: null }
}

/**
 * Shown while a provider has no list read: the exact models the pinned CLIs (Claude Code 2.1.319,
 * Codex 0.166.0) offered when this was written, with no effort levels, so Effort offers only
 * Default. Update it when the guest pins move.
 */
export const BUILT_IN_MODEL_CATALOG: Record<'claude' | 'codex', readonly AgentCatalogModelDto[]> = {
  claude: [
    builtIn('claude-fable-5-2', 'Fable 5.2', false, true),
    builtIn('claude-opus-5-5', 'Opus 5.5'),
    builtIn('claude-sonnet-5-5', 'Sonnet 5.5'),
    builtIn('claude-haiku-5-5', 'Haiku 5.5'),
    builtIn('claude-fable-5-1', 'Fable 5.1'),
    builtIn('claude-sonnet-5', 'Sonnet 5'),
    builtIn('claude-opus-5', 'Opus 5'),
    builtIn('claude-fable-5', 'Fable 5'),
    builtIn('claude-haiku-4-5-20251001', 'Haiku 4.5', true),
    builtIn('claude-opus-4-8', 'Opus 4.8', true),
    builtIn('claude-opus-4-7', 'Opus 4.7', true),
    builtIn('claude-opus-4-6', 'Opus 4.6', true),
    builtIn('claude-sonnet-4-6', 'Sonnet 4.6', true),
  ],
  codex: [
    builtIn('gpt-6.2-sol', 'GPT-6.2-Sol', false, true),
    builtIn('gpt-6.2-astra', 'GPT-6.2-Astra'),
    builtIn('gpt-6.1-terra', 'GPT-6.1 Terra'),
    builtIn('gpt-6.1-sol', 'GPT-6.1-Sol'),
    builtIn('gpt-6-astra', 'GPT-6-Astra'),
    builtIn('gpt-6-sol', 'GPT-6-Sol'),
    builtIn('gpt-6-luna', 'GPT-6-Luna'),
    builtIn('gpt-5.6-sol', 'GPT-5.6-Sol'),
    builtIn('gpt-5.6-terra', 'GPT-5.6-Terra'),
    builtIn('gpt-5.6-luna', 'GPT-5.6-Luna'),
  ],
}

export const modelCatalogSchemas = {
  AgentCatalogModel,
  AgentProviderCatalog,
  AgentModelCatalog,
  AgentModelCatalogRefresh,
  AgentModelCatalogRefreshReceipt,
}
