import { useMemo, useState } from 'react'
import type { AgentProviderId } from '@invimport/contracts'
import { SearchablePicker } from '#/forms'
import { useMinute } from '#/components/ui'
import type { CatalogViews } from '#/agents/model-catalog'
import { ModelOptionLabel } from './ModelOptionLabel'
import {
  chosenOption,
  modelMenu,
  modelOptionText,
  type ModelChoice,
  type ModelOption,
} from './model-options'

export type { ModelChoice } from './model-options'

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
  /** Each provider's model list. */
  catalogs: CatalogViews
  /** Null picks Default. */
  onChange: (choice: ModelChoice | null) => void
  /** Try again, inside a list whose last read failed. */
  onRetry: (provider: AgentProviderId) => void
  labelHidden?: boolean
  disabled?: boolean
}

const CLOSED = { claude: false, codex: false }

/**
 * One searchable model choice across providers, on the shared `SearchablePicker`: a saved model
 * the list no longer offers, Default, then each provider's models by name and exact ID with the
 * older ones folded, then a typed exact ID once per provider that can be picked. Picking a model
 * picks its provider.
 */
export function ModelPicker({
  label,
  providers,
  selectable,
  value,
  fallback,
  catalogs,
  onChange,
  onRetry,
  labelHidden = false,
  disabled = false,
}: Props) {
  const [input, setInput] = useState('')
  const [olderOpen, setOlderOpen] = useState(CLOSED)
  const now = useMinute()
  const single = providers.length === 1
  const query = input.trim()

  const options = useMemo(
    () => modelMenu({ providers, selectable, catalogs, value, fallback, query, olderOpen, now }),
    [providers, selectable, catalogs, value, fallback, query, olderOpen, now],
  )

  function pick(option: ModelOption) {
    switch (option.kind) {
      case 'default':
        onChange(null)
        return
      case 'model':
      case 'exact':
        onChange({ provider: option.provider, model: option.model })
        return
      case 'retry':
        onRetry(option.provider)
        return
      case 'older':
        setOlderOpen((open) => ({ ...open, [option.provider]: !open[option.provider] }))
        return
      case 'note':
      case 'invalid':
        return
    }
  }

  function optionKey(option: ModelOption) {
    switch (option.kind) {
      case 'default':
      case 'invalid':
        return option.kind
      case 'note':
      case 'retry':
      case 'older':
        return `${option.kind}:${option.provider}`
      case 'model':
      case 'exact':
        return `${option.kind}:${option.provider}:${option.model}`
    }
  }

  let shown: ModelOption | null = null
  if (value) {
    shown = chosenOption(catalogs[value.provider], value)
  } else if (fallback) {
    shown = { kind: 'default', label: fallback }
  }

  return (
    <SearchablePicker<ModelOption>
      label={label}
      labelHidden={labelHidden}
      options={options}
      value={shown}
      inputValue={input}
      onInputChange={setInput}
      onChange={pick}
      getOptionLabel={modelOptionText}
      getOptionValue={optionKey}
      formatOptionLabel={(option, context) => (
        <ModelOptionLabel option={option} context={context} single={single} />
      )}
      keepsMenuOpen={(option) => option.kind === 'retry' || option.kind === 'older'}
      isOptionDisabled={(option) =>
        option.kind === 'invalid' ||
        option.kind === 'note' ||
        (option.kind === 'model' && !selectable[option.provider])
      }
      disabled={disabled}
      noOptionsMessage={() => (query ? 'No models match' : 'No models')}
      placeholder={single ? 'Choose a model or type its exact ID' : 'Search models by name or ID'}
    />
  )
}
