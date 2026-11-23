import type { ReactNode } from 'react'
import { useFormContext } from 'react-hook-form'
import styled from 'styled-components'
import { AGENT_MODEL_SUGGESTIONS, type AgentProviderId } from '@invimport/contracts'
import { SegmentedControl, Small } from '#/components/ui'
import { CheckboxLabel, Input } from '#/forms'
import { color, radius, space, typeVar } from '#/theme/generated/tokens'
import type { ProviderStatus } from '#/components/agents/provider-status'
import { PROVIDER_LABEL, validModel, type ProviderFormValues } from './provider-form'
import { SignInHelp } from './SignInHelp'

const AUTHENTICATION = [
  { id: 'subscription', label: 'Subscription' },
  { id: 'api_key', label: 'API key' },
]

/**
 * One provider, set up on its own: on or off and sign-in, which save as they change, the default
 * model with its own Save, and its credential panel.
 */
export function ProviderCard({
  provider,
  status,
  textBusy,
  refused,
  onEnabledChange,
  onAutoEdit,
  onTextEdit,
  credential,
}: {
  provider: AgentProviderId
  /** What its credential panel shows. */
  status: ProviderStatus
  /** The model field's Save is running, so the field is read-only. */
  textBusy: boolean
  /** Why its switch was refused: the last provider on, or no saved model ID to turn on with. */
  refused?: 'last' | 'model'
  onEnabledChange: (enabled: boolean) => void
  /** Reports an edit to the sign-in choice, which fires no input event. */
  onAutoEdit: () => void
  onTextEdit: () => void
  credential: ReactNode
}) {
  const { register, watch, setValue, formState } = useFormContext<ProviderFormValues>()
  const settings = watch(`providers.${provider}`)
  const label = PROVIDER_LABEL[provider]
  const modelError = formState.errors.providers?.[provider]?.default_model
  const listId = `${provider}-models`
  const statusId = `${provider}-card-status`
  const errorId = `${provider}-model-error`
  const refusedId = `${provider}-refused`

  return (
    <Card role="group" aria-label={label} aria-describedby={statusId}>
      <Head>
        <b>{label}</b>
        <Small id={statusId}>{status}</Small>
      </Head>
      <CheckboxLabel>
        <input
          type="checkbox"
          checked={settings.enabled}
          aria-describedby={refused ? refusedId : undefined}
          onChange={(event) => onEnabledChange(event.target.checked)}
        />
        On
      </CheckboxLabel>
      {refused && (
        <Invalid id={refusedId} role="alert">
          {refused === 'last'
            ? 'At least one provider stays on.'
            : `Save a valid default model before turning ${label} on.`}
        </Invalid>
      )}
      <SegmentedControl
        label={`${label} sign-in`}
        options={AUTHENTICATION}
        value={settings.authentication}
        onChange={(id) => {
          setValue(`providers.${provider}.authentication`, id as 'api_key' | 'subscription', {
            shouldDirty: true,
          })
          onAutoEdit()
        }}
      />
      <Small>
        <SignInHelp provider={provider} authentication={settings.authentication} />
      </Small>
      <ModelField>
        Default model
        <Model
          {...register(`providers.${provider}.default_model`, {
            validate: (value, values) => validModel(value, values.providers[provider].enabled),
            onChange: onTextEdit,
          })}
          aria-invalid={modelError ? true : undefined}
          aria-describedby={modelError ? errorId : undefined}
          list={listId}
          readOnly={textBusy}
          autoComplete="off"
          placeholder="Choose a model or enter its exact ID"
        />
      </ModelField>
      <datalist id={listId}>
        {AGENT_MODEL_SUGGESTIONS[provider].map((model) => (
          <option key={model} value={model} />
        ))}
      </datalist>
      {modelError && (
        <Invalid id={errorId} role="alert">
          Choose a valid model ID for {label}.
        </Invalid>
      )}
      {credential}
    </Card>
  )
}

const Card = styled.div`
  display: flex;
  flex: 1 1 280px;
  flex-direction: column;
  align-items: flex-start;
  gap: ${space[4]};
  min-width: 0;
  padding: ${space[6]};
  border: 1px solid ${color.lineStrong};
  border-radius: ${radius.btn};
  background: ${color.surface};
  code {
    overflow-wrap: anywhere;
  }
  small {
    color: ${color.muted};
  }
`

const Head = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: ${space[4]};
  width: 100%;
`

const ModelField = styled.label`
  display: flex;
  flex-direction: column;
  gap: ${space[2]};
  width: 100%;
`

const Model = styled(Input)`
  width: 100%;
  max-width: 320px;
`

const Invalid = styled.span`
  font-size: ${typeVar.small.size};
  color: ${color.bad};
`
