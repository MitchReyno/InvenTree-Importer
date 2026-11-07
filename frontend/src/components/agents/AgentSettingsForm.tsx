import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import styled from 'styled-components'
import type { AgentSelectionDto, AgentSettingsDto } from '@invimport/contracts'
import type { agentsClient } from '@invimport/contracts/client'
import { Button, Notice, Paragraph } from '../ui/primitives'

interface Props {
  initial: AgentSettingsDto
  client: ReturnType<typeof agentsClient>
  onDirtyChange: (dirty: boolean) => void
}
const EMPTY: AgentSelectionDto = { provider: 'codex', authentication: 'subscription', model: '' }
type FormValues = AgentSelectionDto & { session_concurrency: number }

const formValues = (settings: AgentSettingsDto): FormValues => ({
  ...(settings.selection ?? EMPTY),
  session_concurrency: settings.session_concurrency,
})

export function AgentSettingsForm({ initial, client, onDirtyChange }: Props) {
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const [revision, setRevision] = useState(initial.revision)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const { register, handleSubmit, reset, watch, setValue, formState } = useForm<FormValues>({
    defaultValues: formValues(initial),
  })
  const provider = watch('provider')
  const authentication = watch('authentication')
  const presets =
    provider === 'codex'
      ? ['gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6-astra', 'gpt-6-luna']
      : ['sonnet', 'opus', 'haiku']

  const save = handleSubmit(async ({ session_concurrency, ...selection }) => {
    onDirtyChange(true)
    setBusy(true)
    setMessage('')
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
      onDirtyChange(false)
      setMessage(
        'Default saved. New attempts use this selection; queued and running sessions keep their original model.',
      )
    } catch {
      if (!mounted.current) {
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
      <label>
        Provider
        <select
          {...register('provider', {
            onChange: () => setValue('model', '', { shouldDirty: true }),
          })}
          disabled={busy}
        >
          <option value="codex">OpenAI · Codex</option>
          <option value="claude">Anthropic · Claude Code</option>
        </select>
      </label>
      <label>
        Authentication
        <select {...register('authentication')} disabled={busy}>
          <option value="subscription">Subscription · host CLI login</option>
          <option value="api_key">API key · worker environment</option>
        </select>
      </label>
      <label>
        Default model
        <input
          {...register('model', {
            required: true,
            pattern: /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/,
          })}
          list="agent-models"
          required
          maxLength={128}

          disabled={busy}
          autoComplete="off"
          placeholder="Choose a model or enter its exact ID"
        />
        <datalist id="agent-models">
          {presets.map((model) => (
            <option key={model} value={model} />
          ))}
        </datalist>
      </label>
      {formState.errors.model && <Notice role="alert">Choose a valid model ID.</Notice>}
      <label>
        Sessions running at once
        <select {...register('session_concurrency', { valueAsNumber: true })} disabled={busy}>
          {[1, 2, 3, 4, 5, 6, 7, 8].map((limit) => (
            <option key={limit} value={limit}>
              {limit}
            </option>
          ))}
        </select>
      </label>
      <Paragraph>
        Sessions waiting for an answer or finished hold no slot. Lowering the limit lets running
        sessions finish; only new starts wait.
      </Paragraph>
      <Paragraph>
        Presets do not verify account access. Claude aliases resolve when the CLI starts; sessions
        also record the resolved model. There is no automatic model or billing fallback.
      </Paragraph>
      {authentication === 'api_key' ? (
        <Paragraph>
          Set <code>{provider === 'codex' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY'}</code> in the
          separately supervised worker environment. Keys stay on the host and are never entered or
          returned here.
        </Paragraph>
      ) : (
        <Paragraph>
          {provider === 'codex' ? (
            <>
              Sign in with <code>codex login</code> using{' '}
              <code>CODEX_HOME="$INTAKE_AGENT_STATE_ROOT/codex"</code>. This dedicated directory
              must have no custom configuration, plugins or skills.
            </>
          ) : (
            <>
              Sign in with <code>claude auth login</code> on the host as the worker's user. The
              application uses that native login without copying credentials.
            </>
          )}
        </Paragraph>
      )}
      <Paragraph>
        Start <code>pnpm dev</code> with <code>INTAKE_PROCESSING_PROFILE=native-agent/2</code> for
        sessions that propose lots from photos, or <code>native-agent/1</code> for one queued
        result. Saving settings starts no agent.
      </Paragraph>
      <Actions>
        <Button type="submit" disabled={busy}>
          Save default
        </Button>
        <Button type="button" disabled={busy} onClick={() => void discard()}>
          Discard and reload
        </Button>
      </Actions>
      {message && <Notice role="status">{message}</Notice>}
    </Form>
  )
}

const Form = styled.form`
  display: grid;
  gap: 16px;
  max-width: 720px;
  label {
    display: grid;
    gap: 6px;
    font-weight: 600;
  }
  input,
  select {
    width: 100%;
    min-height: 40px;
    padding: 8px;
    font: inherit;
  }
  code {
    overflow-wrap: anywhere;
  }
`
const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`
