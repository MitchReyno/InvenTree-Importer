import {
  BUILT_IN_MODEL_CATALOG,
  type AgentModelCatalogDto,
  type AgentModelCatalogRefreshDto,
  type AgentProviderCatalogDto,
  type AgentProviderId,
  type AgentSettingsDto,
} from '@invimport/contracts'
import { builtinCatalog, catalogModel, CLAUDE_MODELS, providerCatalog } from '#/test/model-catalog'

/**
 * The model list states the fixture page can open on, chosen with `?models=` in its address:
 * `current` (the default), `reading` (Codex's first read), `failed` (Claude's read failed after
 * yesterday's), `builtin` (never read), `stale` (Claude's list from an earlier sign-in) and
 * `gone` (a saved model and a saved effort the current list no longer takes).
 */
export type FixtureListState = 'current' | 'reading' | 'failed' | 'builtin' | 'stale' | 'gone'

const STATES: readonly FixtureListState[] = [
  'current',
  'reading',
  'failed',
  'builtin',
  'stale',
  'gone',
]

export function fixtureListState(): FixtureListState {
  const asked = new URLSearchParams(location.search).get('models')
  return STATES.find((state) => state === asked) ?? 'current'
}

/** How long the fake read takes after Check again, Try again or a sign-in. */
const READ_MS = 1800

const CODEX_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra']

/** Codex's ten models, as this account's ChatGPT sign-in lists them. */
const CODEX_MODELS = BUILT_IN_MODEL_CATALOG.codex.map((model) => {
  if (model.id === 'gpt-6.2-sol') {
    return catalogModel(model.id, model.name, {
      default: true,
      efforts: CODEX_LEVELS,
      default_effort: 'low',
    })
  }
  if (model.id === 'gpt-6.1-terra') {
    return catalogModel(model.id, model.name)
  }
  return catalogModel(model.id, model.name, {
    efforts: ['low', 'medium', 'high', 'xhigh'],
    default_effort: 'medium',
  })
})

function today(hour: number, minute: number) {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute).toISOString()
}

function yesterday(hour: number, minute: number) {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, hour, minute).toISOString()
}

function claudeList(state: FixtureListState): AgentProviderCatalogDto {
  const read = { read_at: today(9, 12), attempted_at: today(9, 12), cli_version: '2.1.319' }
  switch (state) {
    case 'failed':
      return providerCatalog(CLAUDE_MODELS, {
        ...read,
        state: 'failed',
        read_at: yesterday(16, 40),
        failure: 'timeout',
      })
    case 'builtin':
      return builtinCatalog([...BUILT_IN_MODEL_CATALOG.claude])
    case 'stale':
      return providerCatalog(CLAUDE_MODELS, { ...read, state: 'stale_sign_in' })
    case 'current':
    case 'reading':
    case 'gone':
      return providerCatalog(CLAUDE_MODELS, read)
  }
}

function codexList(state: FixtureListState): AgentProviderCatalogDto {
  switch (state) {
    case 'reading':
      return builtinCatalog([...BUILT_IN_MODEL_CATALOG.codex], { state: 'reading' })
    case 'builtin':
      return builtinCatalog([...BUILT_IN_MODEL_CATALOG.codex])
    case 'current':
    case 'failed':
    case 'stale':
    case 'gone':
      return providerCatalog(CODEX_MODELS, {
        read_at: today(9, 12),
        attempted_at: today(9, 12),
        cli_version: '0.166.0',
      })
  }
}

/** The settings the page opens with: both providers on, and the steps the state shows best. */
export function fixtureSettings(state: FixtureListState): AgentSettingsDto {
  const stageSelections: AgentSettingsDto['stage_selections'] =
    state === 'gone'
      ? {
          examine: { provider: 'claude', model: 'claude-sonnet-4-6', effort: 'xhigh' },
          research: { provider: 'codex', model: 'gpt-6.2-sol', effort: 'high' },
          images: { provider: 'claude', model: 'claude-opus-4-6' },
        }
      : {
          research: { provider: 'codex', model: 'gpt-6.2-sol', effort: 'high' },
          images: { provider: 'claude', model: 'claude-opus-5-5', effort: 'max' },
        }
  return {
    revision: '7',
    providers: {
      claude: { enabled: true, authentication: 'subscription', default_model: 'claude-opus-5-5' },
      codex: {
        enabled: true,
        authentication: 'subscription',
        default_model: 'gpt-6.2-sol',
        default_effort: 'low',
      },
    },
    default_provider: 'claude',
    stage_selections: stageSelections,
    session_concurrency: 3,
    new_batch_instructions: '',
    part_description_style: '',
    auto_tags_default: false,
    web: { public_pages: true, prefer_datasheets: true },
  }
}

/**
 * An in-memory catalogue read: the chosen state, and a read requested by Check again, Try again
 * or a sign-in that runs for a moment and then lands the provider's current list.
 */
export function fakeModelCatalog(state: FixtureListState) {
  const lists: Record<AgentProviderId, AgentProviderCatalogDto> = {
    claude: claudeList(state),
    codex: codexList(state),
  }
  const landsAt: Partial<Record<AgentProviderId, number>> = {}
  if (state === 'reading') {
    landsAt.codex = Number.POSITIVE_INFINITY
  }

  function land(provider: AgentProviderId) {
    const due = landsAt[provider]
    if (due === undefined || Date.now() < due) {
      return
    }
    delete landsAt[provider]
    lists[provider] = (provider === 'claude' ? claudeList : codexList)('current')
  }

  return {
    modelCatalog: async (): Promise<AgentModelCatalogDto> => {
      land('claude')
      land('codex')
      await new Promise((resolve) => setTimeout(resolve, 120))
      return { claude: lists.claude, codex: lists.codex }
    },
    refreshModelCatalog: async ({ provider, invalidate }: AgentModelCatalogRefreshDto) => {
      const listed = lists[provider]
      const stale = invalidate === true && !listed.builtin
      lists[provider] = { ...listed, state: stale ? 'stale_sign_in' : 'reading' }
      landsAt[provider] = Date.now() + READ_MS
      return { provider, authentication: listed.authentication, stale_sign_in: stale }
    },
  }
}
