import { useState, type ReactNode } from 'react'
import { FormProvider } from 'react-hook-form'
import styled from 'styled-components'
import type { AgentProviderId, AgentSettingsStage } from '@invimport/contracts'
import { SettingRow, Small } from '#/components/ui'
import { space } from '#/theme/generated/tokens'
import type { ProviderStatus } from '#/components/agents/provider-status'
import { SettingsCard } from '#/components/settings/SettingsCard'
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
import { Stack } from './Stack'
import { StepChoices } from './StepChoices'
import { useSubsectionForm, type SubsectionFormProps } from './useSubsectionForm'

/**
 * Providers and "Provider and model per step": one form with one Save, because turning a
 * provider off resets its steps. Sessions sits between the two on the page.
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
  const { form, state, busy, waiting, dirty, markDirty, save, reload, discard } = useSubsectionForm(
    {
      ...props,
      id: 'providers',
      read: providerFormValues,
      write: providerFormUpdate,
    },
  )
  const [reset, setReset] = useState<readonly AgentSettingsStage[]>([])
  const [noProvider, setNoProvider] = useState(false)
  const values = form.watch()

  function setEnabled(provider: AgentProviderId, enabled: boolean) {
    const current = form.getValues()
    if (enabled) {
      form.reset(turnOn(current, provider), { keepDefaultValues: true, keepFieldsRef: true })
    } else {
      const next = turnOff(current, provider)
      form.reset(next.values, { keepDefaultValues: true, keepFieldsRef: true })
      setReset((steps) => [...new Set([...steps, ...next.reset])])
    }
    setNoProvider(false)
    markDirty()
  }

  function submit() {
    save((current) => {
      // At least one provider must be on for this form; the other subsections save without one.
      if (!PROVIDERS.some((provider) => current.providers[provider].enabled)) {
        setNoProvider(true)
        return false
      }
      setReset([])
      return true
    })
  }

  // Shown beside both of the form's Saves, so the one pressed always says why nothing was sent.
  const bar = (
    <>
      {noProvider && <Small role="alert">Turn on at least one provider to save providers.</Small>}
      <SaveBar
        state={state}
        busy={busy}
        waiting={waiting}
        dirty={dirty}
        onSave={submit}
        onReload={() => {
          setReset([])
          reload()
        }}
        onDiscard={() => {
          setReset([])
          setNoProvider(false)
          discard()
        }}
      />
    </>
  )

  return (
    <FormProvider {...form}>
      <AgentSubsection
        id="providers"
        title="Providers"
        lead="Set up each provider on its own. Turn on the ones you want; steps can use either."
      >
        <Cards>
          {PROVIDERS.map((provider) => (
            <ProviderCard
              key={provider}
              provider={provider}
              status={status[provider]}
              busy={busy}
              onEnabledChange={(enabled) => setEnabled(provider, enabled)}
              onEdit={markDirty}
              credential={credentials[provider]}
            />
          ))}
        </Cards>
        <SettingsCard aria-label="Default provider">
          <SettingRow
            label="Default provider"
            help="Steps set to Default use this provider's default model."
          >
            {({ named }) => (
              <Stack>
                <Choices role="radiogroup" {...named}>
                  {PROVIDERS.map((provider) => (
                    <label key={provider}>
                      <input
                        type="radio"
                        value={provider}
                        disabled={busy || !values.providers[provider].enabled}
                        {...form.register('default_provider', { onChange: markDirty })}
                      />
                      {PROVIDER_LABEL[provider]}
                    </label>
                  ))}
                </Choices>
                <Small>Saved together with Provider and model per step.</Small>
                {bar}
              </Stack>
            )}
          </SettingRow>
        </SettingsCard>
      </AgentSubsection>
      {sessions}
      <AgentSubsection
        id="models"
        title="Provider and model per step"
        lead="Mix providers: for example, Claude for Examine and Codex for Research. New sessions use these; running ones keep theirs."
      >
        <SettingsCard aria-label="Provider and model per step">
          <SettingRow
            label="Each step"
            help="Default follows the default provider. A step can use any provider that is on."
          >
            <Stack>
              <StepChoices busy={busy} reset={reset} onEdit={markDirty} />
              {bar}
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
