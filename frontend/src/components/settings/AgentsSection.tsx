import { useQuery, useQueryClient } from '@tanstack/react-query'
import styled from 'styled-components'
import type { AgentSessionListDto, AgentSettingsDto } from '@invimport/contracts'
import type { agentsClient } from '@invimport/contracts/client'
import { serverQueryKey, useServerScope } from '#/queries/scope'
import { useRetainedPollInterval } from '#/components/operations/LiveUpdates'
import { Banner, Button, Link, Paragraph, SettingRow, Small, Switch } from '#/components/ui'
import { color, space, typeVar } from '#/theme/generated/tokens'
import { AgentSettingsForm } from '#/components/agents/AgentSettingsForm'
import { ChatGPTSignIn } from '#/components/agents/ChatGPTSignIn'
import { PauseAllAgents } from '#/components/agents/PauseAllAgents'
import { PersonalClaudeCredential } from '#/components/agents/PersonalClaudeCredential'
import { slotUse } from '#/components/agents/slot-use'
import { useChatGPTSignIn } from '#/components/agents/useChatGPTSignIn'
import { usePersonalClaudeCredential } from '#/components/agents/usePersonalClaudeCredential'
import { Select, TextArea } from '#/forms'
import { SettingsCard } from './SettingsCard'
import { SettingsSection } from './SettingsSection'

type Props = {
  client: ReturnType<typeof agentsClient>
  onDirtyChange: (dirty: boolean) => void
}

const STEPS = ['Examine', 'Research', 'Images', 'Inventory']

/**
 * Settings › Agents: the stored agent settings, the credential panels behind each provider card,
 * Pause all and the deferred "More control" card. The panels' state lives here, so it mounts and
 * unmounts with the section and the provider cards mirror the panels.
 */
export function AgentsSection({ client, onDirtyChange }: Props) {
  const scope = useServerScope()
  const poll = useRetainedPollInterval()
  const credential = usePersonalClaudeCredential()
  const signIn = useChatGPTSignIn()
  const queryClient = useQueryClient()
  const settingsKey = serverQueryKey(scope, 'agent-settings')
  const settings = useQuery({
    queryKey: settingsKey,
    queryFn: () => client.settings(),
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  })
  // The Agents page's list; its first page gives the slot use it shows too.
  const sessions = useQuery({
    queryKey: serverQueryKey(scope, 'agent-sessions', 'newest'),
    queryFn: () => client.sessions(),
    refetchInterval: poll === false ? 10000 : poll,
  })
  const loaded = settings.isFetchedAfterMount && settings.data

  /** A read already running is older than the confirmed settings, so it must not replace them. */
  async function adoptLoaded(confirmed: AgentSettingsDto) {
    await queryClient.cancelQueries({ queryKey: settingsKey })
    queryClient.setQueryData(settingsKey, confirmed)
  }

  return (
    <SettingsSection
      title="Agents"
      lead="How agent sessions run for every batch. A running turn finishes with the settings it started with."
      agent
    >
      {(settings.isError || settings.fetchStatus === 'paused') && (
        <div role="alert">
          <Banner
            tone="warn"
            action={<Button onClick={() => void settings.refetch()}>Retry</Button>}
          >
            Settings unavailable. Unsaved input is preserved.
          </Banner>
        </div>
      )}
      {!settings.isFetchedAfterMount && (
        <Paragraph role="status">Loading saved settings…</Paragraph>
      )}
      {loaded && (
        <AgentSettingsForm
          initial={settings.data}
          client={client}
          onDirtyChange={onDirtyChange}
          providerStatus={{ claude: credential.card, codex: signIn.card }}
          onLoaded={(loaded) => void adoptLoaded(loaded)}
          slots={
            <SlotMeter
              list={sessions.data}
              failed={sessions.isError}
              limit={settings.data.session_concurrency}
            />
          }
        />
      )}
      {loaded && (
        <>
          <SettingsCard aria-label="Pause">
            <SettingRow
              label="Pause all agents"
              help="Paused batches keep their place and resume where they stopped."
            >
              <PauseAllAgents pauseAll={client.pauseAll} list={sessions.data} />
            </SettingRow>
          </SettingsCard>
          <SettingsCard aria-label="Sign-in">
            <SettingRow
              label="Personal subscriptions"
              help="Sign the shared VM's runners in to your own Claude or ChatGPT subscription."
            >
              <Panels>
                <PersonalClaudeCredential credential={credential} />
                <ChatGPTSignIn signIn={signIn} />
              </Panels>
            </SettingRow>
          </SettingsCard>
          <MoreControl />
        </>
      )}
    </SettingsSection>
  )
}

type SlotMeterProps = {
  list: AgentSessionListDto | undefined
  failed: boolean
  /** The saved limit, which the server applies; an unsaved stepper value isn't in force yet. */
  limit: number
}

/** "3 of 3 in use · 1 queued", from the agent sessions list, with a link to it. */
function SlotMeter({ list, failed, limit }: SlotMeterProps) {
  if (failed) {
    return <Small>Slot use unavailable.</Small>
  }
  if (!list || list.sessions_supported === false) {
    return null
  }
  const { inUse, queued } = slotUse(list.sessions)
  const use =
    queued > 0 ? `${inUse} of ${limit} in use · ${queued} queued` : `${inUse} of ${limit} in use`

  return (
    <Meter>
      <span>{use}</span>
      <Link href="#agents">See sessions</Link>
    </Meter>
  )
}

/** Controls the design adds that the app can't store yet; each is disabled and explained. */
function MoreControl() {
  return (
    <SettingsCard aria-label="More control">
      <SettingRow
        label="Model per step"
        help="A lighter model for Images, the strongest for Examine."
        disabledReason="Not available yet: every step uses the model above."
      >
        {({ disabled }) => (
          <Steps>
            {STEPS.map((step) => (
              <label key={step}>
                {step}
                <Select defaultValue="same" {...disabled}>
                  <option value="same">Same as above</option>
                </Select>
              </label>
            ))}
          </Steps>
        )}
      </SettingRow>
      <SettingRow
        label="Instructions for every new batch"
        help="Copied into a new batch's instructions, where you can change them."
        disabledReason="Not available yet: write instructions in each batch's Capture › Batch settings."
      >
        {({ named, disabled }) => <TextArea rows={3} readOnly {...named} {...disabled} />}
      </SettingRow>
      <SettingRow
        label="Web research"
        help="Research reads public pages from an isolated browser."
        disabledReason="Not available yet: these switches aren't stored, so research is unchanged."
      >
        {({ disabled }) => (
          <Steps>
            <Switch
              label="Allow public web pages"
              checked={false}
              onChange={() => {}}
              {...disabled}
            />
            <Switch
              label="Prefer manufacturer datasheets over distributor pages"
              checked={false}
              onChange={() => {}}
              {...disabled}
            />
          </Steps>
        )}
      </SettingRow>
    </SettingsCard>
  )
}

const Panels = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: ${space[6]};
  fieldset {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: ${space[4]};
    margin: ${space[4]} 0 0;
    border: 1px solid ${color.line};
  }
`

const Meter = styled.span`
  display: inline-flex;
  flex-wrap: wrap;
  gap: ${space[4]};
  font-size: ${typeVar.small.size};
`

const Steps = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: ${space[3]};
  label {
    gap: ${space[4]};
  }
`
