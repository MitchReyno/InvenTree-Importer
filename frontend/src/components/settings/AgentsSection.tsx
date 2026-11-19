import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { AgentSettingsDto } from '@invimport/contracts'
import type { agentsClient } from '@invimport/contracts/client'
import { serverQueryKey } from '#/queries/scope'
import type { AgentSubsectionId } from '#/navigation/app-route'
import { useRetainedPollInterval, useServerScope } from '#/context'
import { Banner, Button, Paragraph, SettingRow } from '#/components/ui'
import { ChatGPTSignIn } from '#/components/agents/ChatGPTSignIn'
import { PauseAllAgents } from '#/components/agents/PauseAllAgents'
import { PersonalClaudeCredential } from '#/components/agents/PersonalClaudeCredential'
import { useChatGPTSignIn } from '#/components/agents/useChatGPTSignIn'
import { usePersonalClaudeCredential } from '#/components/agents/usePersonalClaudeCredential'
import { SettingsCard } from './SettingsCard'
import { SettingsSection } from './SettingsSection'
import { AgentSubsection, subsectionHeadingId } from './agents/AgentSubsection'
import { DescriptionsCard } from './agents/DescriptionsCard'
import { SlotMeter } from './agents/SlotMeter'
import { WebResearchRow } from './agents/WebResearchRow'
import { DescriptionStyleRow } from './agents/DescriptionStyleRow'
import { InstructionsForm } from './agents/InstructionsForm'
import { ProvidersAndSteps } from './agents/ProvidersAndSteps'
import { SessionsForm } from './agents/SessionsForm'
import { TagSuggestionsForm } from './agents/TagSuggestionsForm'
import { useDirtyForms } from './agents/useDirtyForms'

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
  const ready = Boolean(loaded)
  const focused = useRef<AgentSubsectionId | undefined>(undefined)
  const reportDirty = useDirtyForms(onDirtyChange)

  // Syncs the page with the route's location hash. Headings render before the settings load, so
  // the target exists on the first run; the ref keeps a refetch from moving focus again.
  useEffect(() => {
    if (!subsection) {
      // Back on the section itself: the next subsection link scrolls and focuses again.
      focused.current = undefined
      return
    }
    // Loading the settings replaces the first subsections' headings; focus follows the new one
    // only when it was lost with the old, never taking it from where the operator moved it.
    const lost = document.activeElement === document.body
    if (focused.current === subsection && !lost) {
      return
    }
    const heading = document.getElementById(subsectionHeadingId(subsection))
    heading?.scrollIntoView?.({ block: 'start' })
    heading?.focus()
    focused.current = subsection
  }, [subsection, ready])

  /** A read already running is older than the confirmed settings, so it must not replace them. */
  async function adoptLoaded(confirmed: AgentSettingsDto) {
    await queryClient.cancelQueries({ queryKey: settingsKey })
    queryClient.setQueryData(settingsKey, confirmed)
  }

  const unavailable = (settings.isError || settings.fetchStatus === 'paused') && (
    <div role="alert">
      <Banner tone="warn" action={<Button onClick={() => void settings.refetch()}>Retry</Button>}>
        Settings unavailable. Unsaved input is preserved.
      </Banner>
    </div>
  )
  const waiting = (
    <Paragraph role="status" $onField>
      Waiting for the saved settings…
    </Paragraph>
  )
  const form = loaded && {
    client,
    loaded: settings.data,
    onLoaded: (confirmed: AgentSettingsDto) => void adoptLoaded(confirmed),
    reportDirty,
  }
  const sessionsSubsection = (
    <AgentSubsection id="sessions" title="Sessions">
      {form ? (
        <SessionsForm
          {...form}
          slots={
            <SlotMeter
              list={sessions.data}
              failed={sessions.isError}
              limit={settings.data.session_concurrency}
            />
          }
          pause={
            <SettingRow
              label="Pause all agents"
              help="Paused batches keep their place and resume where they stopped."
            >
              <PauseAllAgents pauseAll={client.pauseAll} list={sessions.data} />
            </SettingRow>
          }
        />
      ) : (
        waiting
      )}
    </AgentSubsection>
  )

  return (
    <SettingsSection
      title="Agents"
      lead="Everything that shapes how agents work, for every batch. A running turn finishes with the settings it started with."
      agent
    >
      {unavailable}
      {form ? (
        <ProvidersAndSteps
          {...form}
          status={{ claude: credential.card, codex: signIn.card }}
          credentials={{
            claude: <PersonalClaudeCredential credential={credential} />,
            codex: <ChatGPTSignIn signIn={signIn} />,
          }}
          sessions={sessionsSubsection}
        />
      ) : (
        <>
          <AgentSubsection id="providers" title="Providers">
            {!settings.isFetchedAfterMount && (
              <Paragraph role="status" $onField>
                Loading saved settings…
              </Paragraph>
            )}
          </AgentSubsection>
          {sessionsSubsection}
          <AgentSubsection id="models" title="Provider and model per step">
            {waiting}
          </AgentSubsection>
        </>
      )}
      <AgentSubsection id="instructions" title="Instructions">
        {form ? <InstructionsForm {...form} /> : waiting}
      </AgentSubsection>
      <AgentSubsection
        id="descriptions"
        title="Descriptions and naming"
        lead="How agents write the free-text fields InvenTree shows. Existing records keep their text unless you change it in Review."
      >
        <DescriptionsCard style={form ? <DescriptionStyleRow {...form} /> : waiting} />
      </AgentSubsection>
      <AgentSubsection id="tags" title="Tag suggestions">
        {form ? <TagSuggestionsForm {...form} /> : waiting}
      </AgentSubsection>
      <AgentSubsection id="research" title="Web research">
        <SettingsCard aria-label="Web research">
          <WebResearchRow />
        </SettingsCard>
      </AgentSubsection>
    </SettingsSection>
  )
}
