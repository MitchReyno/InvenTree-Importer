import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import styled from 'styled-components'
import type { AgentSettingsDto } from '@invimport/contracts'
import type { agentsClient } from '@invimport/contracts/client'
import { serverQueryKey } from '#/queries/scope'
import type { AgentSubsectionId } from '#/navigation/app-route'
import { useRetainedPollInterval, useServerScope } from '#/context'
import { Banner, Button, Paragraph, SettingRow } from '#/components/ui'
import { color, space } from '#/theme/generated/tokens'
import { AgentSettingsForm } from '#/components/agents/AgentSettingsForm'
import { ChatGPTSignIn } from '#/components/agents/ChatGPTSignIn'
import { PauseAllAgents } from '#/components/agents/PauseAllAgents'
import { PersonalClaudeCredential } from '#/components/agents/PersonalClaudeCredential'
import { useChatGPTSignIn } from '#/components/agents/useChatGPTSignIn'
import { usePersonalClaudeCredential } from '#/components/agents/usePersonalClaudeCredential'
import { SettingsCard } from './SettingsCard'
import { SettingsSection } from './SettingsSection'
import { AgentSubsection, subsectionHeadingId } from './agents/AgentSubsection'
import { DescriptionsCard } from './agents/DescriptionsCard'
import { ModelPerStepRow } from './agents/ModelPerStepRow'
import { NewBatchInstructionsRow } from './agents/NewBatchInstructionsRow'
import { SlotMeter } from './agents/SlotMeter'
import { TagSuggestionsRow } from './agents/TagSuggestionsRow'
import { WebResearchRow } from './agents/WebResearchRow'

type Props = {
  client: ReturnType<typeof agentsClient>
  onDirtyChange: (dirty: boolean) => void
  /** The subsection the route points at; the page scrolls to it and focuses its heading. */
  subsection?: AgentSubsectionId
}

/**
 * Settings › Agents: every setting that shapes agent behaviour, in subsections. The credential
 * panels' state lives here, so it mounts and unmounts with the section and the provider cards
 * mirror the panels.
 */
export function AgentsSection({ client, onDirtyChange, subsection }: Props) {
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
  const focused = useRef<AgentSubsectionId | undefined>(undefined)

  // Syncs the page with the route's location hash. Headings render before the settings load, so
  // the target exists on the first run; the ref keeps a refetch from moving focus again.
  useEffect(() => {
    if (!subsection) {
      // Back on the section itself: the next subsection link scrolls and focuses again.
      focused.current = undefined
      return
    }
    if (focused.current === subsection) {
      return
    }
    const heading = document.getElementById(subsectionHeadingId(subsection))
    heading?.scrollIntoView?.({ block: 'start' })
    heading?.focus()
    focused.current = subsection
  }, [subsection])

  /** A read already running is older than the confirmed settings, so it must not replace them. */
  async function adoptLoaded(confirmed: AgentSettingsDto) {
    await queryClient.cancelQueries({ queryKey: settingsKey })
    queryClient.setQueryData(settingsKey, confirmed)
  }

  return (
    <SettingsSection
      title="Agents"
      lead="Everything that shapes how agents work, for every batch. A running turn finishes with the settings it started with."
      agent
    >
      <AgentSubsection id="providers" title="Providers">
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
          <Paragraph role="status" $onField>
            Loading saved settings…
          </Paragraph>
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
        )}
      </AgentSubsection>
      <AgentSubsection id="sessions" title="Sessions">
        {loaded ? (
          <SettingsCard aria-label="Pause">
            <SettingRow
              label="Pause all agents"
              help="Paused batches keep their place and resume where they stopped."
            >
              <PauseAllAgents pauseAll={client.pauseAll} list={sessions.data} />
            </SettingRow>
          </SettingsCard>
        ) : (
          <Paragraph role="status" $onField>
            Waiting for the saved settings…
          </Paragraph>
        )}
      </AgentSubsection>
      <AgentSubsection
        id="models"
        title="Provider and model per step"
        lead="New sessions use these; running ones keep theirs."
      >
        <SettingsCard aria-label="Provider and model per step">
          <ModelPerStepRow />
        </SettingsCard>
      </AgentSubsection>
      <AgentSubsection id="instructions" title="Instructions">
        <SettingsCard aria-label="Instructions">
          <NewBatchInstructionsRow />
        </SettingsCard>
      </AgentSubsection>
      <AgentSubsection
        id="descriptions"
        title="Descriptions and naming"
        lead="How agents write the free-text fields InvenTree shows. Existing records keep their text unless you change it in Review."
      >
        <DescriptionsCard />
      </AgentSubsection>
      <AgentSubsection id="tags" title="Tag suggestions">
        <SettingsCard aria-label="Tag suggestions">
          <TagSuggestionsRow />
        </SettingsCard>
      </AgentSubsection>
      <AgentSubsection id="research" title="Web research">
        <SettingsCard aria-label="Web research">
          <WebResearchRow />
        </SettingsCard>
      </AgentSubsection>
    </SettingsSection>
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
