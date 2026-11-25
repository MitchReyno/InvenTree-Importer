import {
  BUILT_IN_MODEL_CATALOG,
  type AgentCatalogModelDto,
  type AgentModelCatalogDto,
  type AgentProviderCatalogDto,
  type AgentSettingsDto,
} from '@invimport/contracts'

const CLAUDE_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max']

/** One listed model; efforts default to none. */
export function catalogModel(
  id: string,
  name: string,
  fields: Partial<Omit<AgentCatalogModelDto, 'id' | 'name'>> = {},
): AgentCatalogModelDto {
  return {
    id,
    name,
    older: false,
    default: false,
    efforts: [],
    default_effort: null,
    usable: null,
    ...fields,
  }
}

/** Claude's 13 models, as a subscription read lists them. */
export const CLAUDE_MODELS: AgentCatalogModelDto[] = [
  catalogModel('claude-fable-5-2', 'Fable 5.2', { default: true, efforts: CLAUDE_LEVELS }),
  catalogModel('claude-opus-5-5', 'Opus 5.5', { efforts: CLAUDE_LEVELS }),
  catalogModel('claude-sonnet-5-5', 'Sonnet 5.5', { efforts: CLAUDE_LEVELS }),
  catalogModel('claude-haiku-5-5', 'Haiku 5.5', { efforts: ['low', 'medium', 'high'] }),
  catalogModel('claude-fable-5-1', 'Fable 5.1', { efforts: CLAUDE_LEVELS }),
  catalogModel('claude-sonnet-5', 'Sonnet 5', { efforts: CLAUDE_LEVELS }),
  catalogModel('claude-opus-5', 'Opus 5', { efforts: CLAUDE_LEVELS }),
  catalogModel('claude-fable-5', 'Fable 5', { efforts: CLAUDE_LEVELS }),
  catalogModel('claude-haiku-4-5-20251001', 'Haiku 4.5', { older: true }),
  catalogModel('claude-opus-4-8', 'Opus 4.8', { older: true, efforts: ['low', 'medium', 'high'] }),
  catalogModel('claude-opus-4-7', 'Opus 4.7', { older: true, efforts: ['low', 'medium', 'high'] }),
  catalogModel('claude-sonnet-4-6', 'Sonnet 4.6', { older: true, efforts: ['low', 'medium'] }),
  catalogModel('claude-opus-4-1', 'Opus 4.1', { older: true, efforts: ['low', 'medium'] }),
]

const CODEX_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra']

/** Codex's models, as a ChatGPT read lists them. */
export const CODEX_MODELS: AgentCatalogModelDto[] = [
  catalogModel('gpt-6.2-sol', 'GPT-6.2-Sol', {
    default: true,
    efforts: CODEX_LEVELS,
    default_effort: 'low',
  }),
  catalogModel('gpt-6.2-astra', 'GPT-6.2-Astra', {
    efforts: ['low', 'medium', 'high'],
    default_effort: 'medium',
  }),
  catalogModel('gpt-6.1-terra', 'GPT-6.1 Terra', { efforts: [], default_effort: null }),
]

export const READ_AT = '2026-11-26T09:12:00+11:00'

/** A provider's list read from its CLI in the agent VM, current unless a test says otherwise. */
export function providerCatalog(
  models: AgentCatalogModelDto[],
  fields: Partial<AgentProviderCatalogDto> = {},
): AgentProviderCatalogDto {
  return {
    state: 'current',
    authentication: 'subscription',
    source: 'cli',
    read_in: 'vm',
    cli_version: '2.1.319',
    read_at: READ_AT,
    attempted_at: READ_AT,
    failure: null,
    builtin: false,
    models,
    ...fields,
  }
}

/** The built-in list a provider shows before any read is stored. */
export function builtinCatalog(
  models: AgentCatalogModelDto[],
  fields: Partial<AgentProviderCatalogDto> = {},
): AgentProviderCatalogDto {
  return providerCatalog(models, {
    state: 'never_read',
    source: null,
    read_in: null,
    cli_version: null,
    read_at: null,
    attempted_at: null,
    builtin: true,
    ...fields,
  })
}

export function modelCatalog(fields: Partial<AgentModelCatalogDto> = {}): AgentModelCatalogDto {
  return {
    claude: providerCatalog(CLAUDE_MODELS),
    codex: providerCatalog(CODEX_MODELS, { cli_version: '0.166.0' }),
    ...fields,
  }
}

/** Both providers' built-in lists for their saved sign-in methods, as a server with no read stored answers. */
export function builtinModelCatalog(
  settings?: Pick<AgentSettingsDto, 'providers'>,
): AgentModelCatalogDto {
  return {
    claude: builtinCatalog([...BUILT_IN_MODEL_CATALOG.claude], {
      authentication: settings?.providers.claude.authentication ?? 'subscription',
    }),
    codex: builtinCatalog([...BUILT_IN_MODEL_CATALOG.codex], {
      authentication: settings?.providers.codex.authentication ?? 'subscription',
    }),
  }
}
