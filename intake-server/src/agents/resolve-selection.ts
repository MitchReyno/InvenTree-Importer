import {
  AGENT_SETTINGS_STAGES,
  type AgentSelectionDto,
  type AgentSettingsDto,
  type AgentSettingsStage,
} from '@invimport/contracts'

type Resolvable = Pick<AgentSettingsDto, 'providers' | 'default_provider' | 'stage_selections'>

function ownChoice(settings: Resolvable, stage: string) {
  return (AGENT_SETTINGS_STAGES as readonly string[]).includes(stage)
    ? settings.stage_selections[stage as AgentSettingsStage]
    : undefined
}

/**
 * The provider, sign-in method and model an attempt at this step seals: the step's own choice
 * while its provider is on, otherwise the default provider. Undefined when no default is on.
 */
export function resolveSelection(
  settings: Resolvable,
  stage: string,
): AgentSelectionDto | undefined {
  const choice = ownChoice(settings, stage)
  if (choice && settings.providers[choice.provider].enabled) {
    return {
      provider: choice.provider,
      authentication: settings.providers[choice.provider].authentication,
      model: choice.model,
    }
  }
  const provider = settings.default_provider
  if (!provider || !settings.providers[provider].enabled) {
    return undefined
  }
  return {
    provider,
    authentication: settings.providers[provider].authentication,
    model: settings.providers[provider].default_model,
  }
}
