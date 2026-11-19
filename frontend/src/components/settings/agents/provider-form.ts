import {
  AGENT_SETTINGS_STAGES,
  type AgentProviderId,
  type AgentProviderSettingsDto,
  type AgentSettingsDto,
  type AgentSettingsStage,
} from '@invimport/contracts'

export const PROVIDERS = ['claude', 'codex'] as const satisfies readonly AgentProviderId[]
export const PROVIDER_LABEL: Record<AgentProviderId, string> = { claude: 'Claude', codex: 'Codex' }
export const STAGE_LABEL: Record<AgentSettingsStage, string> = {
  examine: 'Examine',
  research: 'Research',
  images: 'Images',
  inventory: 'Inventory',
}
/** The model ID pattern the server checks, so the form says so before sending. */
export const MODEL_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/

/** Text the server stores unchanged: no NUL, and no unpaired surrogate. */
export function storable(value: string) {
  return !value.includes('\u0000') && !/\p{Cs}/u.test(value)
}

/** A model the server accepts: any provider's within 128 characters, an enabled one's an ID. */
export function validModel(value: string, enabled: boolean) {
  return value.length <= 128 && storable(value) && (!enabled || MODEL_ID.test(value))
}

/** A step's choice in the form: '' is Default. */
export type StepChoice = { provider: AgentProviderId | ''; model: string }

export type ProviderFormValues = {
  providers: Record<AgentProviderId, AgentProviderSettingsDto>
  /** '' while no provider is on. */
  default_provider: AgentProviderId | ''
  stages: Record<AgentSettingsStage, StepChoice>
}

export function providerFormValues(settings: AgentSettingsDto): ProviderFormValues {
  const stages = Object.fromEntries(
    AGENT_SETTINGS_STAGES.map((stage) => {
      const choice = settings.stage_selections[stage]
      return [stage, choice ? { ...choice } : { provider: '', model: '' }]
    }),
  ) as ProviderFormValues['stages']
  return {
    providers: {
      claude: { ...settings.providers.claude },
      codex: { ...settings.providers.codex },
    },
    default_provider: settings.default_provider ?? '',
    stages,
  }
}

/** The fields this form owns, as they go into a whole settings update. */
export function providerFormUpdate(values: ProviderFormValues) {
  const stageSelections: AgentSettingsDto['stage_selections'] = {}
  for (const stage of AGENT_SETTINGS_STAGES) {
    const { provider, model } = values.stages[stage]
    if (provider) {
      stageSelections[stage] = { provider, model }
    }
  }
  return {
    providers: values.providers,
    default_provider: values.default_provider || null,
    stage_selections: stageSelections,
  }
}

/**
 * Turning a provider off resets the steps that named it to Default and, when it was the default,
 * moves the default to the other provider that is on. Returns the steps it reset.
 */
export function turnOff(values: ProviderFormValues, provider: AgentProviderId) {
  const reset = AGENT_SETTINGS_STAGES.filter((stage) => values.stages[stage].provider === provider)
  const other = PROVIDERS.find((id) => id !== provider && values.providers[id].enabled)
  const next: ProviderFormValues = {
    providers: {
      ...values.providers,
      [provider]: { ...values.providers[provider], enabled: false },
    },
    default_provider:
      values.default_provider === provider ? (other ?? '') : values.default_provider,
    stages: { ...values.stages },
  }
  for (const stage of reset) {
    next.stages[stage] = { provider: '', model: '' }
  }
  return { values: next, reset }
}

/** Turning a provider on makes it the default when none is on yet. */
export function turnOn(values: ProviderFormValues, provider: AgentProviderId): ProviderFormValues {
  return {
    ...values,
    providers: {
      ...values.providers,
      [provider]: { ...values.providers[provider], enabled: true },
    },
    default_provider: values.default_provider || provider,
  }
}
