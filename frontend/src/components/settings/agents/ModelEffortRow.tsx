import { useId, useState, type ReactNode } from 'react'
import styled from 'styled-components'
import type { AgentEffortDto, AgentProviderId } from '@invimport/contracts'
import { media, Pill, Small } from '#/components/ui'
import {
  effortChoices,
  effortDropped,
  effortLabel,
  effortNotAccepted,
  modelName,
  notOffered,
  type CatalogViews,
  type EffortChoice,
} from '#/agents/model-catalog'
import { color, space, typeVar } from '#/theme/generated/tokens'
import { EffortSelect } from './EffortSelect'
import { ModelPicker, type ModelChoice } from './ModelPicker'
import { PROVIDER_LABEL } from './provider-form'

/** A model and the effort sent with it; absent effort is Default. */
export type ModelEffort = ModelChoice & { effort?: AgentEffortDto }

type Props = {
  /** The picker's name, such as "Research" or "Default model". */
  label: string
  labelHidden?: boolean
  /** The Effort select's name, such as "Research effort". */
  effortLabel: string
  providers: readonly AgentProviderId[]
  selectable: Record<AgentProviderId, boolean>
  /** The current choice; null is Default, or nothing chosen yet where there is no Default. */
  value: ModelEffort | null
  /** The Default option's words, for a step that can follow the default provider. */
  fallback?: string
  /** What Effort shows while the row is on Default, which it can't change. */
  defaultEffort?: EffortChoice
  catalogs: CatalogViews
  /** Who runs the model, for the not-offered warning: "New Images sessions". */
  runs: string
  /** One change of model and effort together, which saves as one. Null is Default. */
  onChange: (next: ModelEffort | null) => void
  onRetry: (provider: AgentProviderId) => void
  /** A note of the row's own, such as a provider turned off. */
  note?: ReactNode
}

/**
 * A model picker with its Effort select beside it, and the row's warnings: a saved model the list
 * no longer offers, a saved effort the model doesn't take, and an effort the last pick reset.
 */
export function ModelEffortRow({
  label,
  labelHidden,
  effortLabel: effortName,
  providers,
  selectable,
  value,
  fallback,
  defaultEffort,
  catalogs,
  runs,
  onChange,
  onRetry,
  note,
}: Props) {
  const notesId = useId()
  // The last pick's reset, said under the row until the next change.
  const [reset, setReset] = useState<string | null>(null)
  const view = value ? catalogs[value.provider] : undefined
  const name = value && view ? modelName(view, value.model) : ''
  const gone = value && view ? notOffered(view, value.model) : false
  const refused = value && view ? effortNotAccepted(view, value.model, value.effort) : false

  function pickModel(choice: ModelChoice | null) {
    if (!choice) {
      setReset(null)
      onChange(null)
      return
    }
    // Picking the model already chosen changes nothing, its effort included.
    if (value && choice.provider === value.provider && choice.model === value.model) {
      return
    }
    const effort = value?.effort
    const target = catalogs[choice.provider]
    if (effort !== undefined && effortDropped(target, choice.model, effort)) {
      setReset(
        `Effort set to Default: ${modelName(target, choice.model)} has no ${effortLabel(effort)}.`,
      )
      onChange(choice)
      return
    }
    setReset(null)
    onChange(effort === undefined ? choice : { ...choice, effort })
  }

  function pickEffort(effort: AgentEffortDto | undefined) {
    if (!value) {
      return
    }
    setReset(null)
    const { effort: _previous, ...choice } = value
    onChange(effort === undefined ? choice : { ...choice, effort })
  }

  const choices =
    value && view
      ? effortChoices(view, value.model, value.effort)
      : { options: [defaultEffort ?? { value: '', label: 'Default' }], disabled: true }

  return (
    <Row>
      <Controls>
        <ModelPicker
          label={label}
          labelHidden={labelHidden}
          providers={providers}
          selectable={selectable}
          value={value ? { provider: value.provider, model: value.model } : null}
          fallback={fallback}
          catalogs={catalogs}
          onChange={pickModel}
          onRetry={onRetry}
        />
        <EffortSelect
          label={effortName}
          options={choices.options}
          value={value?.effort}
          onChange={value ? pickEffort : null}
          disabled={choices.disabled}
          describedBy={gone || refused || reset ? notesId : undefined}
        />
      </Controls>
      <div id={notesId}>
        {gone && value && (
          <Warning>
            <Pill tone="warn" glyph="!">
              Not offered
            </Pill>
            <span>
              {PROVIDER_LABEL[value.provider]} no longer lists {value.model}. {runs} will try it and
              fail if {PROVIDER_LABEL[value.provider]} refuses it. Pick another model.
            </span>
          </Warning>
        )}
        {refused && value?.effort && (
          <Warning>
            <Pill tone="warn" glyph="!">
              Not accepted
            </Pill>
            <span>
              {name} takes no “{effortLabel(value.effort)}”.
            </span>
          </Warning>
        )}
        {reset && <Small role="status">{reset}</Small>}
      </div>
      {note}
    </Row>
  )
}

const Row = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space[2]};
  width: 100%;
  small {
    color: ${color.muted};
  }
`

const Controls = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(120px, 160px);
  align-items: end;
  gap: ${space[3]};
  /* On a phone the model's name needs the whole row; Effort sits under it. */
  ${media.phone} {
    grid-template-columns: minmax(0, 1fr);
  }
`

const Warning = styled.p`
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: ${space[2]};
  margin: 0;
  font-size: ${typeVar.small.size};
`
