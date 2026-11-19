import { useFormContext } from 'react-hook-form'
import styled from 'styled-components'
import {
  AGENT_MODEL_SUGGESTIONS,
  AGENT_SETTINGS_STAGES,
  type AgentProviderId,
  type AgentSettingsStage,
} from '@invimport/contracts'
import { Small } from '#/components/ui'
import { Input, Select } from '#/forms'
import { color, space, typeVar } from '#/theme/generated/tokens'
import {
  validModel,
  PROVIDER_LABEL,
  PROVIDERS,
  STAGE_LABEL,
  type ProviderFormValues,
} from './provider-form'

/** Each step's provider and model, or Default; only providers that are on can be chosen. */
export function StepChoices({
  busy,
  reset,
  onEdit,
}: {
  busy: boolean
  /** Steps whose choice was reset because their provider was turned off. */
  reset: readonly AgentSettingsStage[]
  onEdit: () => void
}) {
  const { register, watch, setValue, formState } = useFormContext<ProviderFormValues>()
  const values = watch()
  const on = PROVIDERS.filter((provider) => values.providers[provider].enabled)
  const fallback = values.default_provider
    ? `Default · ${PROVIDER_LABEL[values.default_provider]} ${values.providers[values.default_provider].default_model}`
    : 'Default · no provider on'

  return (
    <Steps>
      {AGENT_SETTINGS_STAGES.map((stage) => {
        const choice = values.stages[stage]
        const listId = `step-${stage}-models`
        const invalid = formState.errors.stages?.[stage]?.model
        return (
          <Step key={stage} role="group" aria-label={STAGE_LABEL[stage]}>
            <b>{STAGE_LABEL[stage]}</b>
            <Select
              aria-label={`${STAGE_LABEL[stage]} provider`}
              value={choice.provider}
              disabled={busy}
              onChange={(event) => {
                const provider = event.target.value as AgentProviderId | ''
                setValue(
                  `stages.${stage}`,
                  {
                    provider,
                    model: provider ? values.providers[provider].default_model : '',
                  },
                  { shouldDirty: true },
                )
                onEdit()
              }}
            >
              <option value="">{fallback}</option>
              {on.map((provider) => (
                <option key={provider} value={provider}>
                  {PROVIDER_LABEL[provider]}
                </option>
              ))}
            </Select>
            {choice.provider && (
              <>
                <Input
                  aria-label={`${STAGE_LABEL[stage]} model`}
                  list={listId}
                  readOnly={busy}
                  autoComplete="off"
                  aria-invalid={invalid ? true : undefined}
                  aria-describedby={invalid ? `step-${stage}-error` : undefined}
                  {...register(`stages.${stage}.model`, {
                    validate: (value, current) =>
                      !current.stages[stage].provider || validModel(value, true),
                    onChange: onEdit,
                  })}
                />
                <datalist id={listId}>
                  {AGENT_MODEL_SUGGESTIONS[choice.provider].map((model) => (
                    <option key={model} value={model} />
                  ))}
                </datalist>
              </>
            )}
            {invalid && (
              <Invalid id={`step-${stage}-error`} role="alert">
                Choose a valid model ID.
              </Invalid>
            )}
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
  gap: ${space[4]};
  width: 100%;
`

const Step = styled.div`
  display: grid;
  grid-template-columns: minmax(80px, auto) minmax(0, 1fr) minmax(0, 1fr);
  align-items: center;
  gap: ${space[3]} ${space[4]};
  small {
    grid-column: 2 / -1;
    color: ${color.muted};
  }
`

const Invalid = styled.span`
  grid-column: 2 / -1;
  font-size: ${typeVar.small.size};
  color: ${color.bad};
`
