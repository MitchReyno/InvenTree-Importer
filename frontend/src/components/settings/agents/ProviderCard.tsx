import type { ReactNode } from 'react'
import { useFormContext } from 'react-hook-form'
import styled from 'styled-components'
import { AGENT_MODEL_SUGGESTIONS, type AgentProviderId } from '@invimport/contracts'
import { SegmentedControl, Small } from '#/components/ui'
import { CheckboxLabel, Input } from '#/forms'
import { color, radius, space, typeVar } from '#/theme/generated/tokens'
import type { ProviderStatus } from '#/components/agents/provider-status'
import { MODEL_ID, PROVIDER_LABEL, type ProviderFormValues } from './provider-form'
import { SignInHelp } from './SignInHelp'

const AUTHENTICATION = [
  { id: 'subscription', label: 'Subscription' },
  { id: 'api_key', label: 'API key' },
]

/** One provider, set up on its own: on or off, sign-in, default model and its credential panel. */
export function ProviderCard({
  provider,
  status,
  busy,
  onEnabledChange,
  onEdit,
  credential,
}: {
  provider: AgentProviderId
  /** What its credential panel shows. */
  status: ProviderStatus
  busy: boolean
  onEnabledChange: (enabled: boolean) => void
  /** A control that fires no input event reports its edit here. */
  onEdit: () => void
  credential: ReactNode
}) {
  const { register, watch, setValue, formState } = useFormContext<ProviderFormValues>()
  const settings = watch(`providers.${provider}`)
  const label = PROVIDER_LABEL[provider]
  const modelError = formState.errors.providers?.[provider]?.default_model
  const listId = `${provider}-models`
  const statusId = `${provider}-card-status`

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
          disabled={busy}
          onChange={(event) => onEnabledChange(event.target.checked)}
        />
        On
      </CheckboxLabel>
      <SegmentedControl
        label={`${label} sign-in`}
        options={AUTHENTICATION}
        value={settings.authentication}
        disabled={busy}
        onChange={(id) => {
          setValue(`providers.${provider}.authentication`, id as 'api_key' | 'subscription', {
            shouldDirty: true,
          })
          onEdit()
        }}
      />
      <Small>
        <SignInHelp provider={provider} authentication={settings.authentication} />
      </Small>
      <ModelField>
        Default model
        <Model
          {...register(`providers.${provider}.default_model`, {
            validate: (value, values) =>
              !values.providers[provider].enabled || MODEL_ID.test(value),
          })}
          aria-invalid={modelError ? true : undefined}
          list={listId}
          readOnly={busy}
          autoComplete="off"
          placeholder="Choose a model or enter its exact ID"
        />
      </ModelField>
      <datalist id={listId}>
        {AGENT_MODEL_SUGGESTIONS[provider].map((model) => (
          <option key={model} value={model} />
        ))}
      </datalist>
      {modelError && <Invalid role="alert">Choose a valid model ID for {label}.</Invalid>}
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
