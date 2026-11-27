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

/** The selection with its effort when one is set; Default (none) leaves the field out. */
function selection(
  provider: AgentSelectionDto['provider'],
  authentication: AgentSelectionDto['authentication'],
  model: string,
  effort: string | undefined,
): AgentSelectionDto {
  return effort === undefined
    ? { provider, authentication, model }
    : { provider, authentication, model, effort }
}

/**
 * The provider, sign-in method, model and effort an attempt at this step seals: the step's own
 * model and effort while its provider is on, otherwise the default provider's default model and
 * effort, so the model and effort always come from the same choice. Undefined when no default is
 * on.
 */
export function resolveSelection(
  settings: Resolvable,
  stage: string,
): AgentSelectionDto | undefined {
  const choice = ownChoice(settings, stage)
  if (choice && settings.providers[choice.provider].enabled) {
    const { authentication } = settings.providers[choice.provider]
    return selection(choice.provider, authentication, choice.model, choice.effort)
  }
  const provider = settings.default_provider
  if (!provider || !settings.providers[provider].enabled) {
    return undefined
  }
  const { authentication, default_model, default_effort } = settings.providers[provider]
  return selection(provider, authentication, default_model, default_effort)
}
