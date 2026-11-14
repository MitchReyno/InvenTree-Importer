import { useId, useState, type ReactNode } from 'react'
import { IntakeRequestError, type agentsClient } from '@invimport/contracts/client'
import type { AgentSelectionDto, AgentSettingsDto } from '@invimport/contracts'
import { useForm } from 'react-hook-form'
import styled from 'styled-components'
import {
  Banner,
  Button,
  media,
  NumberStepper,
  SegmentedControl,
  SettingRow,
  Small,
} from '#/components/ui'
import { Input } from '#/forms'
import { color, radius, size, space, typeVar } from '#/theme/generated/tokens'
import { useMountedRef } from '#/lifecycle/useMountedRef'
import { SettingsCard } from '#/components/settings/SettingsCard'
import type { ProviderStatus } from './provider-status'

type Provider = AgentSelectionDto['provider']
type Authentication = AgentSelectionDto['authentication']

interface Props {
  initial: AgentSettingsDto
  client: ReturnType<typeof agentsClient>
  onDirtyChange: (dirty: boolean) => void
  /** Each provider card's sign-in status, as its credential panel shows it. */
  providerStatus: Record<Provider, ProviderStatus>
  /** Slot use beside the sessions stepper, read from the agent sessions list. */
  slots?: ReactNode
  /** Hears the settings each confirmed save or reload returns, so other readers follow them. */
  onLoaded?: (settings: AgentSettingsDto) => void
}

const EMPTY: AgentSelectionDto = { provider: 'codex', authentication: 'subscription', model: '' }

const MIN_SESSIONS = 1
const MAX_SESSIONS = 8

const PROVIDERS: { id: Provider; label: string }[] = [
  { id: 'claude', label: 'Claude' },
  { id: 'codex', label: 'Codex' },
]

const AUTHENTICATION: { id: Authentication; label: string }[] = [
  { id: 'subscription', label: 'Subscription' },
  { id: 'api_key', label: 'API key' },
]

const PRESETS: Record<Provider, string[]> = {
  codex: ['gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6-astra', 'gpt-6-luna'],
  claude: ['sonnet', 'opus', 'haiku'],
}

const CONFLICT =
  'These settings changed in another tab, so this save was refused. Your edit is kept here; Reload to see the saved settings.'

type FormValues = AgentSelectionDto & { session_concurrency: number }

const formValues = (settings: AgentSettingsDto): FormValues => ({
  ...(settings.selection ?? EMPTY),
  session_concurrency: settings.session_concurrency,
})

function signInHelp(provider: Provider, authentication: Authentication) {
  if (authentication === 'api_key') {
    return (
      <>
        Set <code>{provider === 'codex' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY'}</code> in the
        separately supervised worker environment. Keys stay on the host and are never entered or
        returned here.
      </>
    )
  }
  if (provider === 'codex') {
    return (
      <>
        Sign in with <code>codex login</code> using{' '}
        <code>CODEX_HOME="$INTAKE_AGENT_STATE_ROOT/codex"</code>. This dedicated directory must have
        no custom configuration, plugins or skills.
      </>
    )
  }

  return (
    <>
      Sign in with <code>claude auth login</code> on the host as the worker's user. The application
      uses that native login without copying credentials.
    </>
  )
}

/** The stored agent settings as setting rows, saved together under the loaded revision. */
export function AgentSettingsForm({
  initial,
  client,
  onDirtyChange,
  providerStatus,
  slots,
  onLoaded,
}: Props) {
  const fieldId = useId()
  const modelHelpId = `${fieldId}-model-help`
  const modelErrorId = `${fieldId}-model-error`
  const mounted = useMountedRef()
  const [revision, setRevision] = useState(initial.revision)
  const [message, setMessage] = useState('')
  const [conflict, setConflict] = useState(false)
  const [busy, setBusy] = useState(false)
  const { register, handleSubmit, reset, watch, setValue, formState } = useForm<FormValues>({
    defaultValues: formValues(initial),
  })
  const provider = watch('provider')
  const authentication = watch('authentication')
  const sessions = watch('session_concurrency')

  // A segmented control and a stepper fire no native change event, so they report to the guard.
  function chooseAuthentication(value: Authentication) {
    if (busy) {
      return
    }
    setValue('authentication', value, { shouldDirty: true })
    onDirtyChange(true)
  }

  function chooseSessions(value: number) {
    if (busy) {
      return
    }
    setValue('session_concurrency', value, { shouldDirty: true })
    onDirtyChange(true)
  }

  const save = handleSubmit(async ({ session_concurrency, ...selection }) => {
    onDirtyChange(true)
    setBusy(true)
    setMessage('')
    setConflict(false)
    try {
      const saved = await client.saveSettings({
        expected_revision: revision,
        selection,
        session_concurrency: Number(session_concurrency),
      })
      if (!mounted.current) {
        return
      }
      setRevision(saved.revision)
      reset(formValues(saved))
      onLoaded?.(saved)
      onDirtyChange(false)
      setMessage(
        'Default saved. New attempts use this selection; queued and running sessions keep their original model.',
      )
    } catch (caught) {
      if (!mounted.current) {
        return
      }
      if (caught instanceof IntakeRequestError && caught.code === 'revision_conflict') {
        setConflict(true)
        return
      }
      setMessage(
        'Save was not confirmed. Your selection is preserved. A newer revision may exist; discard and reload to adopt it.',
      )
    } finally {
      if (mounted.current) {
        setBusy(false)
      }
    }
  })

  const discard = async () => {
    onDirtyChange(true)
    setBusy(true)
    try {
      const current = await client.settings()
      if (!mounted.current) {
        return
      }
      setRevision(current.revision)
      reset(formValues(current))
      onLoaded?.(current)
      setConflict(false)
      onDirtyChange(false)
      setMessage('Loaded the current saved default.')
    } catch {
      if (!mounted.current) {
        return
      }
      setMessage('Settings unavailable. Your selection is preserved.')
    } finally {
      if (mounted.current) {
        setBusy(false)
      }
    }
  }

  return (
    <Form onSubmit={save} onChange={() => onDirtyChange(true)}>
      <SettingsCard aria-label="Provider and model">
        <SettingRow label="Provider" help="Who runs the sessions.">
          {({ named }) => (
            <Options role="radiogroup" {...named}>
              {PROVIDERS.map((option) => (
                <ProviderOption key={option.id}>
                  <input
                    type="radio"
                    value={option.id}
                    disabled={busy}
                    aria-label={option.label}
                    aria-describedby={`${fieldId}-${option.id}-status`}
                    {...register('provider', {
                      onChange: () => setValue('model', '', { shouldDirty: true }),
                    })}
                  />
                  <span>
                    <b>{option.label}</b>
                    <ProviderState id={`${fieldId}-${option.id}-status`}>
                      {providerStatus[option.id]}
                    </ProviderState>
                  </span>
                </ProviderOption>
              ))}
            </Options>
          )}
        </SettingRow>
        <SettingRow label="Sign-in" help="Keys are kept on the server and never shown again.">
          <Stack>
            <SegmentedControl
              label="Sign-in method"
              options={AUTHENTICATION}
              value={authentication}
              disabled={busy}
              onChange={(id) => chooseAuthentication(id as Authentication)}
            />
            <Small>{signInHelp(provider, authentication)}</Small>
          </Stack>
        </SettingRow>
        <SettingRow label="Model" help="Each session shows the model that actually answered.">
          {({ named }) => (
            <Stack>
              <ModelInput
                {...register('model', {
                  required: true,
                  pattern: /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/,
                })}
                {...named}
                aria-invalid={formState.errors.model ? true : undefined}
                aria-describedby={
                  formState.errors.model ? `${modelErrorId} ${modelHelpId}` : modelHelpId
                }
                list="agent-models"
                required
                maxLength={128}
                disabled={busy}
                autoComplete="off"
                placeholder="Choose a model or enter its exact ID"
              />
              <datalist id="agent-models">
                {PRESETS[provider].map((model) => (
                  <option key={model} value={model} />
                ))}
              </datalist>
              {formState.errors.model && (
                <Invalid id={modelErrorId} role="alert">
                  Choose a valid model ID.
                </Invalid>
              )}
              <Small id={modelHelpId}>
                Presets do not verify account access. Claude aliases resolve when the CLI starts.
                There is no automatic model or billing fallback.
              </Small>
            </Stack>
          )}
        </SettingRow>
      </SettingsCard>
      <SettingsCard aria-label="Running sessions">
        <SettingRow
          label="Sessions at once"
          help="How many sessions may run turns together, across all batches. Sessions waiting for you hold no slot."
        >
          <Stack>
            <NumberStepper
              label="Sessions at once"
              value={sessions}
              min={MIN_SESSIONS}
              max={MAX_SESSIONS}
              aria-disabled={busy || undefined}
              onChange={chooseSessions}
            />
            {slots}
            <Small>
              Lowering it lets running turns finish; queued sessions wait for a free slot.
            </Small>
          </Stack>
        </SettingRow>
      </SettingsCard>
      <Actions>
        <Button type="submit" variant="primary" disabled={busy}>
          Save
        </Button>
        <Button type="button" disabled={busy} onClick={() => void discard()}>
          Discard and reload
        </Button>
        <Small>
          Start <code>pnpm dev</code> with <code>INTAKE_USE_MOCK_AI_AGENTS=false</code> for sessions
          that propose lots from photos, and add <code>INTAKE_USE_AGENT_SESSIONS=false</code> for
          one queued result instead. Saving settings starts no agent.
        </Small>
      </Actions>
      {conflict && (
        <div role="alert">
          <Banner
            tone="warn"
            action={
              <Button type="button" disabled={busy} onClick={() => void discard()}>
                Reload
              </Button>
            }
          >
            {CONFLICT}
          </Banner>
        </div>
      )}
      {message && (
        <div role="status">
          <Banner tone="warn">{message}</Banner>
        </div>
      )}
    </Form>
  )
}

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: ${space[8]};
  code {
    overflow-wrap: anywhere;
  }
`

const Options = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space[4]};
`

const ProviderOption = styled.label`
  display: flex;
  flex: 1 1 160px;
  align-items: flex-start;
  gap: ${space[5]};
  padding: calc(${space[5]} - 1px) calc(${space[6]} - 1px);
  border: 1px solid ${color.lineStrong};
  border-radius: ${radius.btn};
  background: ${color.surface};
  cursor: pointer;
  input {
    margin-top: 3px;
  }
  span {
    display: flex;
    flex-direction: column;
  }
  &:has(input:checked) {
    border-color: ${color.accent};
    background: ${color.accentWeak};
  }
  ${media.compact} {
    min-height: ${size.touch};
  }
`

const ProviderState = styled.small`
  font-size: ${typeVar.small.size};
  color: ${color.muted};
`

const Stack = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: ${space[4]};
  min-width: 0;
  small {
    color: ${color.muted};
  }
`

const ModelInput = styled(Input)`
  width: 100%;
  max-width: 320px;
`

const Invalid = styled.span`
  font-size: ${typeVar.small.size};
  color: ${color.bad};
`

const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[4]};
  small {
    flex: 1 1 260px;
    color: ${color.muted};
  }
`
