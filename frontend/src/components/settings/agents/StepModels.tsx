import { useFormContext } from 'react-hook-form'
import styled from 'styled-components'
import { AGENT_SETTINGS_STAGES, type AgentSettingsStage } from '@invimport/contracts'
import { Small } from '#/components/ui'
import { color, space } from '#/theme/generated/tokens'
import { ModelPicker } from './ModelPicker'
import { PROVIDER_LABEL, PROVIDERS, STAGE_LABEL, type ProviderFormValues } from './provider-form'

/**
 * Each step's provider and model, or Default, in one searchable picker; only providers that are
 * on can be picked. A pick saves as it changes.
 */
export function StepModels({
  reset,
  onAutoEdit,
}: {
  /** Steps whose choice was reset because their provider was turned off. */
  reset: readonly AgentSettingsStage[]
  onAutoEdit: () => void
}) {
  const { watch, setValue } = useFormContext<ProviderFormValues>()
  const values = watch()
  const selectable = {
    claude: values.providers.claude.enabled,
    codex: values.providers.codex.enabled,
  }
  const fallback = values.default_provider
    ? `Default · ${PROVIDER_LABEL[values.default_provider]} ${values.providers[values.default_provider].default_model}`
    : 'Default · no provider on'

  return (
    <Steps>
      {AGENT_SETTINGS_STAGES.map((stage) => {
        const choice = values.stages[stage]
        return (
          <Step key={stage} role="group" aria-label={STAGE_LABEL[stage]}>
            <ModelPicker
              label={STAGE_LABEL[stage]}
              providers={PROVIDERS}
              selectable={selectable}
              value={choice.provider ? { provider: choice.provider, model: choice.model } : null}
              fallback={fallback}
              onChange={(picked) => {
                setValue(`stages.${stage}`, picked ?? { provider: '', model: '' }, {
                  shouldDirty: true,
                })
                onAutoEdit()
              }}
            />
            {reset.includes(stage) && !choice.provider && (
              <Small role="status">Its provider was turned off, so it now uses Default.</Small>
            )}
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
  display: flex;
  flex-direction: column;
  gap: ${space[2]};
  small {
    color: ${color.muted};
  }
`
