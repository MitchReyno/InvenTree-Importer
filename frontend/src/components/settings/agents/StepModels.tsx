import { useFormContext } from 'react-hook-form'
import styled from 'styled-components'
import {
  AGENT_SETTINGS_STAGES,
  type AgentProviderId,
  type AgentSettingsStage,
} from '@invimport/contracts'
import { Small } from '#/components/ui'
import { effortLabel, modelName, type CatalogViews } from '#/agents/model-catalog'
import { space } from '#/theme/generated/tokens'
import { ModelEffortRow } from './ModelEffortRow'
import { PROVIDER_LABEL, PROVIDERS, STAGE_LABEL, type ProviderFormValues } from './provider-form'

/**
 * Each step's provider, model and effort, or Default, in one searchable picker with Effort beside
 * it; only providers that are on can be picked. A pick saves as it changes.
 */
export function StepModels({
  reset,
  catalogs,
  onRetry,
  onAutoEdit,
}: {
  /** Steps whose choice was reset because their provider was turned off. */
  reset: readonly AgentSettingsStage[]
  catalogs: CatalogViews
  onRetry: (provider: AgentProviderId) => void
  onAutoEdit: () => void
}) {
  const { watch, setValue } = useFormContext<ProviderFormValues>()
  const values = watch()
  const selectable = {
    claude: values.providers.claude.enabled,
    codex: values.providers.codex.enabled,
  }
  const defaultProvider = values.default_provider
  const defaults = defaultProvider ? values.providers[defaultProvider] : undefined
  const fallback =
    defaultProvider && defaults
      ? `Default · ${PROVIDER_LABEL[defaultProvider]} ${modelName(catalogs[defaultProvider], defaults.default_model)}`
      : 'Default · no provider on'
  const defaultEffort = {
    value: '' as const,
    label: defaults?.default_effort ? effortLabel(defaults.default_effort) : 'Default',
  }

  return (
    <Steps>
      {AGENT_SETTINGS_STAGES.map((stage) => {
        const choice = values.stages[stage]
        return (
          <Step key={stage} role="group" aria-label={STAGE_LABEL[stage]}>
            <ModelEffortRow
              label={STAGE_LABEL[stage]}
              effortLabel={`${STAGE_LABEL[stage]} effort`}
              providers={PROVIDERS}
              selectable={selectable}
              value={choice.provider ? { ...choice, provider: choice.provider } : null}
              fallback={fallback}
              defaultEffort={defaultEffort}
              catalogs={catalogs}
              runs={`New ${STAGE_LABEL[stage]} sessions`}
              onRetry={onRetry}
              onChange={(next) => {
                setValue(`stages.${stage}`, next ?? { provider: '', model: '' }, {
                  shouldDirty: true,
                })
                onAutoEdit()
              }}
              note={
                reset.includes(stage) &&
                !choice.provider && (
                  <Small role="status">Its provider was turned off, so it now uses Default.</Small>
                )
              }
            />
          </Step>
        )
      })}
    </Steps>
  )
}

const Steps = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space[5]};
  width: 100%;
`

const Step = styled.div`
  min-width: 0;
`
