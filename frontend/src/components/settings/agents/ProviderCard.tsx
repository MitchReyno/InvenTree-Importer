import type { ReactNode } from 'react'
import { useFormContext } from 'react-hook-form'
import styled from 'styled-components'
import type { AgentProviderId } from '@invimport/contracts'
import {
  Button,
  EventTime,
  Pill,
  RelativeTime,
  SegmentedControl,
  Small,
  Switch,
  useMinute,
  VisuallyHidden,
} from '#/components/ui'
import { color, radius, space, typeVar } from '#/theme/generated/tokens'
import type { ProviderCardStatus } from '#/components/agents/useProviderStatus'
import { ModelPicker } from './ModelPicker'
import { PROVIDER_LABEL, type ProviderFormValues } from './provider-form'
import { SignInHelp } from './SignInHelp'

const AUTHENTICATION = [
  { id: 'subscription', label: 'Subscription' },
  { id: 'api_key', label: 'API key' },
]

type Props = {
  provider: AgentProviderId
  /** Its sign-in status, read from the agent VM. */
  status: ProviderCardStatus
  /** Check again is reading the status. */
  checking: boolean
  onCheckAgain: () => void
  /** Why its switch was refused: the last provider on, or no model ID to turn on with. */
  refused?: 'last' | 'model'
  onEnabledChange: (enabled: boolean) => void
  /** Reports an edit to the sign-in choice or the default model, which save as they change. */
  onAutoEdit: () => void
  /** The button that opens its sign-in dialog. */
  credential: ReactNode
}

/**
 * One provider, set up on its own: on or off, sign-in and default model, which save as they
 * change; its sign-in status from the agent VM, and the button for its sign-in dialog.
 */
export function ProviderCard({
  provider,
  status,
  checking,
  onCheckAgain,
  refused,
  onEnabledChange,
  onAutoEdit,
  credential,
}: Props) {
  const { watch, setValue } = useFormContext<ProviderFormValues>()
  const settings = watch(`providers.${provider}`)
  const label = PROVIDER_LABEL[provider]
  const statusId = `${provider}-card-status`
  const refusedId = `${provider}-refused`

  return (
    <Card role="group" aria-label={label} aria-describedby={statusId}>
      <Head>
        <b>{label}</b>
        <span id={statusId}>
          <Pill tone={status.pill.tone} glyph={status.pill.glyph}>
            {status.pill.word}
          </Pill>
        </span>
      </Head>
      {status.savedAt && (
        <Small>
          Saved <EventTime at={status.savedAt} />
        </Small>
      )}
      <CheckLine status={status} />
      {/* Always present, so the check's progress and outcome are announced as they change. */}
      <VisuallyHidden role="status">{status.announcement}</VisuallyHidden>
      {status.failedAt && (
        <Failure>
          Last session couldn’t sign in · <EventTime at={status.failedAt} />
        </Failure>
      )}
      <Row>
        {credential}
        <Button size="sm" variant="link" disabled={checking} onClick={onCheckAgain}>
          Check again
        </Button>
      </Row>
      <Switch
        label="On"
        checked={settings.enabled}
        aria-describedby={refused ? refusedId : undefined}
        onChange={onEnabledChange}
      />
      {refused && (
        <Invalid id={refusedId} role="alert">
          {refused === 'last'
            ? 'At least one provider stays on.'
            : `Choose a default model before turning ${label} on.`}
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
      <Model>
        <ModelPicker
          label="Default model"
          providers={[provider]}
          // A provider's own default model can be chosen before it is turned on.
          selectable={{ claude: true, codex: true }}
          value={settings.default_model ? { provider, model: settings.default_model } : null}
          onChange={(choice) => {
            if (!choice) {
              return
            }
            setValue(`providers.${provider}.default_model`, choice.model, { shouldDirty: true })
            onAutoEdit()
          }}
        />
      </Model>
    </Card>
  )
}

/** When the VM last checked, and quietly whether a newer check runs, beside the pill. */
function CheckLine({ status }: { status: ProviderCardStatus }) {
  const clock = useMinute()
  if (!status.checkedAt && !status.refreshing) {
    return null
  }

  // The VM's clock, or a minute tick still due, can put a check after the page's clock; it
  // reads as just now rather than in the future.
  const checked = status.checkedAt ? Date.parse(status.checkedAt) : Number.NaN
  const now = Number.isNaN(checked) ? clock : Math.max(clock, checked)

  return (
    <Small>
      {status.checkedAt && (
        <span>
          Checked <RelativeTime at={status.checkedAt} now={now} />
        </span>
      )}
      {status.checkedAt && status.refreshing && ' · '}
      {status.refreshing && <span>Checking…</span>}
    </Small>
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
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: ${space[4]};
  width: 100%;
`

const Row = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space[4]};
`

const Model = styled.div`
  width: 100%;
  max-width: 320px;
`

const Failure = styled.span`
  font-size: ${typeVar.small.size};
  color: ${color.warn};
`

const Invalid = styled.span`
  font-size: ${typeVar.small.size};
  color: ${color.bad};
`
