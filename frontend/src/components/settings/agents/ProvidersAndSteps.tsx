import { useState, type ReactNode } from 'react'
import { FormProvider } from 'react-hook-form'
import styled from 'styled-components'
import {
  AGENT_SETTINGS_STAGES,
  type AgentProviderId,
  type AgentSettingsStage,
} from '@invimport/contracts'
import { SettingRow } from '#/components/ui'
import { space } from '#/theme/generated/tokens'
import type { ProviderStatus } from '#/components/agents/provider-status'
import { SettingsCard } from '#/components/settings/SettingsCard'
import { AgentAutosaveStatus } from './AgentAutosaveStatus'
import { AgentSubsection } from './AgentSubsection'
import {
  PROVIDER_LABEL,
  PROVIDERS,
  providerFormUpdate,
  providerFormValues,
  turnOff,
  turnOn,
} from './provider-form'
import { ProviderCard } from './ProviderCard'
import { SaveBar } from './SaveBar'
import type { FieldKey } from './settings-fields'
import { Stack } from './Stack'
import { StepChoices } from './StepChoices'
import { useSubsectionForm, type SubsectionFormProps } from './useSubsectionForm'

const KEYS: readonly FieldKey[] = [
  ...PROVIDERS.flatMap((provider) => [
    `providers.${provider}.enabled` as const,
    `providers.${provider}.authentication` as const,
    `providers.${provider}.default_model` as const,
  ]),
  'default_provider',
  ...AGENT_SETTINGS_STAGES.map((stage) => `stage_selections.${stage}` as const),
]

/**
 * Providers and "Provider and model per step": one form, because turning a provider off resets
 * its steps and both save together. Switches, choices and selects save as they change; the model
 * fields keep a Save until the model picker replaces them. Sessions sits between the two.
 */
export function ProvidersAndSteps({
  status,
  credentials,
  sessions,
  ...props
}: SubsectionFormProps & {
  /** Each provider card's status, as its credential panel shows it. */
  status: Record<AgentProviderId, ProviderStatus>
  credentials: Record<AgentProviderId, ReactNode>
  /** The Sessions subsection, placed between Providers and the steps. */
  sessions: ReactNode
}) {
  const [reset, setReset] = useState<readonly AgentSettingsStage[]>([])
  const [refused, setRefused] = useState<AgentProviderId | null>(null)
  // Where the model fields' last Save was pressed, so its outcome shows beside those fields.
  const [savedFrom, setSavedFrom] = useState<'providers' | 'models'>('providers')
  const { form, markEdited, autosave, text, textKeys } = useSubsectionForm({
    ...props,
    id: 'providers',
    read: providerFormValues,
    write: providerFormUpdate,
    keys: KEYS,
    onStepsReset: (steps) => setReset((current) => [...new Set([...current, ...steps])]),
  })
  const values = form.watch()

  function setEnabled(provider: AgentProviderId, enabled: boolean) {
    const current = form.getValues()
    if (enabled) {
      form.reset(turnOn(current, provider), { keepDefaultValues: true, keepFieldsRef: true })
      setRefused(null)
      markEdited('auto')
      return
    }
    // At least one provider stays on; turning off the last is refused here and nothing is sent.
    if (!PROVIDERS.some((other) => other !== provider && current.providers[other].enabled)) {
      setRefused(provider)
      return
    }
    const next = turnOff(current, provider)
    form.reset(next.values, { keepDefaultValues: true, keepFieldsRef: true })
    setReset((steps) => [...new Set([...steps, ...next.reset])])
    setRefused(null)
    // Saves at once, with its steps reset to Default, superseding queued choices for it.
    markEdited('auto', { now: true })
  }

  const autosaveStatus = (label: string) => (
    <AgentAutosaveStatus
      label={label}
      state={autosave.state}
      revision={autosave.revision}
      onRetry={autosave.retry}
      onReload={() => {
        setReset([])
        autosave.reload()
      }}
    />
  )

  /** The model fields' Save beside the fields it sends, shown while they hold an edit. */
  function modelBar(place: 'providers' | 'models') {
    const prefix = place === 'providers' ? 'providers.' : 'stage_selections.'
    const edited = textKeys.some((key) => key.startsWith(prefix))
    const outcome = !text.dirty && text.state !== 'idle' && savedFrom === place
    if (!edited && !outcome) {
      return null
    }
    return (
      <SaveBar
        state={text.state}
        busy={text.busy}
        waiting={text.waiting}
        dirty={edited}
        savedMessage="Saved. Sessions queued from now on use it; queued and running ones keep theirs."
        onSave={() => {
          setSavedFrom(place)
          text.save()
        }}
        onRetry={text.retry}
        onReload={text.reload}
        onDiscard={text.discard}
      />
    )
  }

  return (
    <FormProvider {...form}>
      <AgentSubsection
        id="providers"
        lead="Set up each provider on its own. Turn on the ones you want; steps can use either."
        status={autosaveStatus('Providers')}
      >
        <Cards>
          {PROVIDERS.map((provider) => (
            <ProviderCard
              key={provider}
              provider={provider}
              status={status[provider]}
              textBusy={text.busy}
              refused={refused === provider}
              onEnabledChange={(enabled) => setEnabled(provider, enabled)}
              onAutoEdit={() => markEdited('auto')}
              onTextEdit={() => markEdited('text')}
              credential={credentials[provider]}
            />
          ))}
        </Cards>
        {modelBar('providers')}
        <SettingsCard aria-label="Default provider">
          <SettingRow
            label="Default provider"
            help="Steps set to Default use this provider's default model."
          >
            {({ named }) => (
              <Choices role="radiogroup" {...named}>
                {PROVIDERS.map((provider) => (
                  <label key={provider}>
                    <input
                      type="radio"
                      value={provider}
                      disabled={!values.providers[provider].enabled}
                      {...form.register('default_provider', { onChange: () => markEdited('auto') })}
                    />
                    {PROVIDER_LABEL[provider]}
                  </label>
                ))}
              </Choices>
            )}
          </SettingRow>
        </SettingsCard>
      </AgentSubsection>
      {sessions}
      <AgentSubsection
        id="models"
        lead="Mix providers: for example, Claude for Examine and Codex for Research. New sessions use these; running ones keep theirs."
        status={autosaveStatus('Provider and model per step')}
      >
        <SettingsCard aria-label="Provider and model per step">
          <SettingRow
            label="Each step"
            help="Default follows the default provider. A step can use any provider that is on."
          >
            <Stack>
              <StepChoices
                textBusy={text.busy}
                reset={reset}
                savedModel={(provider) => props.loaded.providers[provider].default_model}
                onAutoEdit={() => markEdited('auto')}
                onTextEdit={() => markEdited('text')}
              />
              {modelBar('models')}
            </Stack>
          </SettingRow>
        </SettingsCard>
      </AgentSubsection>
    </FormProvider>
  )
}

const Cards = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space[5]};
`

const Choices = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space[5]};
  label {
    display: inline-flex;
    align-items: center;
    gap: ${space[2]};
  }
`
