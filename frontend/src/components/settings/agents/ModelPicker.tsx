import { useMemo, useState } from 'react'
import type { GroupBase } from 'react-select'
import { AGENT_MODEL_SUGGESTIONS, type AgentProviderId } from '@invimport/contracts'
import { SearchablePicker } from '#/forms'
import { MODEL_ID, PROVIDER_LABEL } from './provider-form'

/** A provider and one of its models; the model may be an exact ID that isn't listed. */
export type ModelChoice = { provider: AgentProviderId; model: string }

type Option =
  | { kind: 'default'; label: string }
  | { kind: 'model'; provider: AgentProviderId; model: string }
  | { kind: 'exact'; provider: AgentProviderId; model: string }
  | { kind: 'invalid'; model: string }

type Props = {
  label: string
  /** The providers listed, in order; a provider card's picker lists only its own. */
  providers: readonly AgentProviderId[]
  /** Which providers' models can be picked; the others show greyed with the reason. */
  selectable: Record<AgentProviderId, boolean>
  /** The current choice; null is Default, or nothing chosen yet where there is no Default. */
  value: ModelChoice | null
  /** The Default option's words, for a step that can follow the default provider. */
  fallback?: string
  /** Null picks Default. */
  onChange: (choice: ModelChoice | null) => void
  disabled?: boolean
}

function offReason(provider: AgentProviderId) {
  return `Turn ${PROVIDER_LABEL[provider]} on to use its models`
}

function matches(text: string, query: string) {
  return text.toLowerCase().includes(query.toLowerCase())
}

/** A provider's listed models, plus the current one when it is an ID the list doesn't have. */
function modelsOf(provider: AgentProviderId, value: ModelChoice | null) {
  const listed = [...AGENT_MODEL_SUGGESTIONS[provider]]
  if (value?.provider === provider && value.model && !listed.includes(value.model)) {
    listed.push(value.model)
  }
  return listed
}

/** The options for a typed query that names no listed model exactly. */
function exactOptions(
  query: string,
  providers: readonly AgentProviderId[],
  selectable: Record<AgentProviderId, boolean>,
  listed: (provider: AgentProviderId) => readonly string[],
): Option[] {
  const offered = providers.filter(
    (provider) => selectable[provider] && !listed(provider).includes(query),
  )
  if (offered.length === 0) {
    return []
  }
  if (!MODEL_ID.test(query)) {
    return [{ kind: 'invalid', model: query }]
  }
  return offered.map((provider) => ({ kind: 'exact', provider, model: query }))
}

/**
 * One searchable model choice across providers, on the shared `SearchablePicker`: Default, then
 * each provider's models grouped and searchable by provider or model ID, then a typed exact ID
 * once per provider that can be picked. Picking a model picks its provider.
 */
export function ModelPicker({
  label,
  providers,
  selectable,
  value,
  fallback,
  onChange,
  disabled = false,
}: Props) {
  const [input, setInput] = useState('')
  const single = providers.length === 1

  const options = useMemo(() => {
    const query = input.trim()
    const list: (Option | GroupBase<Option>)[] = []
    // Default is found by its own name, not by the model it currently stands for.
    if (fallback && (!query || matches('Default', query))) {
      list.push({ kind: 'default', label: fallback })
    }
    for (const provider of providers) {
      const name = PROVIDER_LABEL[provider]
      const models = modelsOf(provider, value).filter(
        (model) => !query || matches(model, query) || matches(name, query),
      )
      if (models.length > 0) {
        list.push({
          label: selectable[provider] ? name : `${name} · ${offReason(provider)}`,
          options: models.map((model) => ({ kind: 'model', provider, model })),
        })
      }
    }
    if (query) {
      list.push(
        ...exactOptions(query, providers, selectable, (provider) => modelsOf(provider, value)),
      )
    }
    return list
  }, [fallback, input, providers, selectable, value])

  function optionLabel(option: Option) {
    switch (option.kind) {
      case 'default':
        return option.label
      case 'model':
        return single ? option.model : `${PROVIDER_LABEL[option.provider]} · ${option.model}`
      case 'exact':
        return `Use “${option.model}” with ${PROVIDER_LABEL[option.provider]}`
      case 'invalid':
        return `“${option.model}” isn’t a model ID: use letters, digits and . _ : / -`
    }
  }

  function optionKey(option: Option) {
    switch (option.kind) {
      case 'default':
        return 'default'
      case 'invalid':
        return 'invalid'
      case 'model':
      case 'exact':
        return `${option.kind}:${option.provider}:${option.model}`
    }
  }

  let shown: Option | null = null
  if (value) {
    shown = { kind: 'model', ...value }
  } else if (fallback) {
    shown = { kind: 'default', label: fallback }
  }

  return (
    <SearchablePicker<Option>
      label={label}
      options={options}
      value={shown}
      inputValue={input}
      onInputChange={setInput}
      onChange={(option) => {
        if (option.kind === 'default') {
          onChange(null)
        } else if (option.kind !== 'invalid') {
          onChange({ provider: option.provider, model: option.model })
        }
      }}
      getOptionLabel={optionLabel}
      getOptionValue={optionKey}
      isOptionDisabled={(option) =>
        option.kind === 'invalid' || (option.kind === 'model' && !selectable[option.provider])
      }
      disabled={disabled}
      noOptionsMessage={() => (input.trim() ? 'No models match' : 'No models')}
      placeholder={single ? 'Choose a model or type its exact ID' : 'Search models by name or ID'}
    />
  )
}
