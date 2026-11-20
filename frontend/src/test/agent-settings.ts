import {
  AGENT_MODEL_SUGGESTIONS,
  type AgentProviderId,
  type AgentProviderSettingsDto,
  type AgentSelectionDto,
  type AgentSettingsDto,
  type AgentSettingsUpdateDto,
} from '@invimport/contracts'

const off = (provider: AgentProviderId): AgentProviderSettingsDto => ({
  enabled: false,
  authentication: 'subscription',
  default_model: AGENT_MODEL_SUGGESTIONS[provider][0],
})

/** Saved agent settings with one provider on as the default (or none), every step on Default. */
export function agentSettings(
  revision: string,
  selection: AgentSelectionDto | null,
  overrides: Partial<Omit<AgentSettingsDto, 'revision'>> = {},
): AgentSettingsDto {
  const providers = { claude: off('claude'), codex: off('codex') }
  if (selection) {
    providers[selection.provider] = {
      enabled: true,
      authentication: selection.authentication,
      default_model: selection.model,
    }
  }
  return {
    revision,
    providers,
    default_provider: selection?.provider ?? null,
    stage_selections: {},
    session_concurrency: 3,
    new_batch_instructions: '',
    part_description_style: '',
    auto_tags_default: false,
    web: { public_pages: true, prefer_datasheets: true },
    ...overrides,
  }
}

/** The same settings as a whole update sent under `expectedRevision`. */
export function agentSettingsUpdate(
  expectedRevision: string,
  selection: AgentSelectionDto | null,
  overrides: Partial<Omit<AgentSettingsDto, 'revision'>> = {},
): AgentSettingsUpdateDto {
  const { revision: _revision, ...fields } = agentSettings('0', selection, overrides)
  return { ...fields, expected_revision: expectedRevision }
}
