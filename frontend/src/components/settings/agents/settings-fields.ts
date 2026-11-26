import {
  AGENT_SETTINGS_STAGES,
  type AgentInstructionStage,
  type AgentProviderId,
  type AgentSettingsDto,
  type AgentSettingsStage,
} from '@invimport/contracts'

/** The settings a save sends, without the revision it is sent under. */
export type SettingsFields = Omit<AgentSettingsDto, 'revision'>

/**
 * One setting a subsection can own. A save sends the newest confirmed settings with only its
 * owned fields replaced, so it never carries another field's draft.
 */
export type FieldKey =
  | `providers.${AgentProviderId}.enabled`
  | `providers.${AgentProviderId}.authentication`
  | `providers.${AgentProviderId}.default_model`
  | `providers.${AgentProviderId}.default_effort`
  | 'default_provider'
  | `stage_selections.${AgentSettingsStage}`
  | `stage_instructions.${AgentInstructionStage}`
  | 'session_concurrency'
  | 'new_batch_instructions'
  | 'part_description_style'
  | 'auto_tags_default'
  | 'web.public_pages'
  | 'web.prefer_datasheets'

const PROVIDERS = ['claude', 'codex'] as const satisfies readonly AgentProviderId[]

type ProviderField = 'enabled' | 'authentication' | 'default_model' | 'default_effort'

function providerKey(key: FieldKey): [AgentProviderId, ProviderField] | undefined {
  const [group, provider, field] = key.split('.')
  if (group !== 'providers') {
    return undefined
  }
  return [provider as AgentProviderId, field as ProviderField]
}

function stageKey(key: FieldKey): AgentSettingsStage | undefined {
  const [group, stage] = key.split('.')
  return group === 'stage_selections' ? (stage as AgentSettingsStage) : undefined
}

function instructionKey(key: FieldKey): AgentInstructionStage | undefined {
  const [group, stage] = key.split('.')
  return group === 'stage_instructions' ? (stage as AgentInstructionStage) : undefined
}

/** One field's value; a step on Default, or without instructions, reads as `undefined`. */
export function fieldValue(settings: SettingsFields, key: FieldKey): unknown {
  const provider = providerKey(key)
  if (provider) {
    return settings.providers[provider[0]][provider[1]]
  }
  const stage = stageKey(key)
  if (stage) {
    return settings.stage_selections[stage]
  }
  const instructed = instructionKey(key)
  if (instructed) {
    return settings.stage_instructions[instructed]
  }
  if (key === 'web.public_pages') {
    return settings.web.public_pages
  }
  if (key === 'web.prefer_datasheets') {
    return settings.web.prefer_datasheets
  }
  return settings[key as keyof SettingsFields]
}

export function sameField(a: SettingsFields, b: SettingsFields, key: FieldKey) {
  return JSON.stringify(fieldValue(a, key)) === JSON.stringify(fieldValue(b, key))
}

/** `target` with the given fields copied from `source`; every other field stays as it is. */
export function withFields(
  target: SettingsFields,
  source: SettingsFields,
  keys: Iterable<FieldKey>,
): SettingsFields {
  const next: SettingsFields = {
    ...target,
    providers: { claude: { ...target.providers.claude }, codex: { ...target.providers.codex } },
    stage_selections: { ...target.stage_selections },
    stage_instructions: { ...target.stage_instructions },
    web: { ...target.web },
  }
  for (const key of keys) {
    const provider = providerKey(key)
    const stage = stageKey(key)
    const instructed = instructionKey(key)
    if (provider) {
      const [id, field] = provider
      const copied = { ...next.providers[id], [field]: source.providers[id][field] }
      // Default effort is absent rather than undefined, as the contract has it.
      if (copied.default_effort === undefined) {
        delete copied.default_effort
      }
      next.providers[id] = copied
    } else if (stage) {
      const choice = source.stage_selections[stage]
      if (choice) {
        next.stage_selections[stage] = { ...choice }
      } else {
        delete next.stage_selections[stage]
      }
    } else if (instructed) {
      // A step without instructions has no key, as the contract has it.
      const text = source.stage_instructions[instructed]
      if (text === undefined) {
        delete next.stage_instructions[instructed]
      } else {
        next.stage_instructions[instructed] = text
      }
    } else if (key === 'web.public_pages') {
      next.web.public_pages = source.web.public_pages
    } else if (key === 'web.prefer_datasheets') {
      next.web.prefer_datasheets = source.web.prefer_datasheets
    } else {
      Object.assign(next, { [key]: source[key as keyof SettingsFields] })
    }
  }
  return next
}

/**
 * Settings a save can send whatever was queued before it: a step naming a provider that is off
 * goes back to Default, and the default provider is one that is on, or none when none is.
 * Returns the steps it reset.
 */
export function withUsableProviders(settings: SettingsFields) {
  const on = PROVIDERS.filter((provider) => settings.providers[provider].enabled)
  const reset = AGENT_SETTINGS_STAGES.filter((stage) => {
    const choice = settings.stage_selections[stage]
    return choice !== undefined && !on.includes(choice.provider)
  })
  const stageSelections = { ...settings.stage_selections }
  for (const stage of reset) {
    delete stageSelections[stage]
  }
  const defaultOn = settings.default_provider !== null && on.includes(settings.default_provider)
  return {
    settings: {
      ...settings,
      stage_selections: stageSelections,
      default_provider: defaultOn ? settings.default_provider : (on[0] ?? null),
    },
    reset,
  }
}
