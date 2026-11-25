import { useState, type ReactNode } from 'react'
import { FormProvider } from 'react-hook-form'
import styled from 'styled-components'
import {
  AGENT_SETTINGS_STAGES,
  type AgentProviderId,
  type AgentSettingsStage,
} from '@invimport/contracts'
import { SegmentedControl, SettingRow } from '#/components/ui'
import { space } from '#/theme/generated/tokens'
import type { ProviderStatusState } from '#/components/agents/useProviderStatus'
import type { ModelCatalogState } from '#/agents/useModelCatalog'
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
  validModel,
} from './provider-form'
import { ProviderCard } from './ProviderCard'
import type { FieldKey } from './settings-fields'
import { StepModels } from './StepModels'
import { useSubsectionForm, type ProviderKept, type SubsectionFormProps } from './useSubsectionForm'

const KEYS: readonly FieldKey[] = [
  ...PROVIDERS.flatMap((provider) => [
    `providers.${provider}.enabled` as const,
    `providers.${provider}.authentication` as const,
    `providers.${provider}.default_model` as const,
    `providers.${provider}.default_effort` as const,
  ]),
  'default_provider',
  ...AGENT_SETTINGS_STAGES.map((stage) => `stage_selections.${stage}` as const),
]

/**
 * Providers and "Provider and model per step": one form, because turning a provider off resets
 * its steps and both save together. Every control saves as it changes. Sessions sits between the
 * two.
 */
export function ProvidersAndSteps({
  status,
  catalog,
  credentials,
  sessions,
  ...props
}: SubsectionFormProps & {
  /** Each provider's sign-in status from the agent VM, with Check again. */
  status: ProviderStatusState
  /** Each provider's model list, with a read on request. */
  catalog: ModelCatalogState
  /** Each provider card's sign-in dialog button. */
  credentials: Record<AgentProviderId, ReactNode>
  /** The Sessions subsection, placed between Providers and the steps. */
  sessions: ReactNode
}) {
  const [reset, setReset] = useState<readonly AgentSettingsStage[]>([])
  const [refused, setRefused] = useState<{
    provider: AgentProviderId
    reason: ProviderKept
  } | null>(null)
  const { form, markEdited, autosave } = useSubsectionForm({
    ...props,
    id: 'providers',
    read: providerFormValues,
    write: providerFormUpdate,
    keys: KEYS,
    onStepsReset: (steps) => setReset((current) => [...new Set([...current, ...steps])]),
    onProviderKept: (provider, reason) => setRefused({ provider, reason }),
  })
  const values = form.watch()

  function setEnabled(provider: AgentProviderId, enabled: boolean) {
    const current = form.getValues()
    if (enabled) {
      // A provider that is on needs a model ID; one picked in the same pause saves with it.
      if (!validModel(current.providers[provider].default_model, true)) {
        setRefused({ provider, reason: 'model' })
        return
      }
      form.reset(turnOn(current, provider), { keepDefaultValues: true, keepFieldsRef: true })
      setRefused(null)
      markEdited('auto')
      return
    }
    // At least one provider stays on; turning off the last is refused here and nothing is sent.
    if (!PROVIDERS.some((other) => other !== provider && current.providers[other].enabled)) {
      setRefused({ provider, reason: 'last' })
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
              checking={status.checking}
              onCheckAgain={() => {
                void status.checkAgain()
                void catalog.refresh(provider)
              }}
              refused={refused?.provider === provider ? refused.reason : undefined}
              onEnabledChange={(enabled) => setEnabled(provider, enabled)}
              onAutoEdit={() => markEdited('auto')}
              credential={credentials[provider]}
              catalogs={catalog.views}
              onRetry={(listed) => void catalog.refresh(listed)}
            />
          ))}
        </Cards>
        <SettingsCard aria-label="Default provider">
          <SettingRow
            label="Default provider"
            help="Steps set to Default use this provider's default model."
          >
            <SegmentedControl
              label="Default provider"
              options={PROVIDERS.map((provider) => ({
                id: provider,
                label: PROVIDER_LABEL[provider],
                disabled: !values.providers[provider].enabled,
              }))}
              value={values.default_provider}
              onChange={(id) => {
                form.setValue('default_provider', id as AgentProviderId, { shouldDirty: true })
                markEdited('auto')
              }}
            />
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
            help="Lists the exact models of every provider that’s on, with the effort levels each accepts. Default follows the default provider."
          >
            <StepModels
              reset={reset}
              catalogs={catalog.views}
              onRetry={(provider) => void catalog.refresh(provider)}
              onAutoEdit={() => markEdited('auto')}
            />
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
