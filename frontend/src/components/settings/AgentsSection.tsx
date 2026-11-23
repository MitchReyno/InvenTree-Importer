import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { AgentSettingsDto } from '@invimport/contracts'
import type { agentsClient } from '@invimport/contracts/client'
import { serverQueryKey } from '#/queries/scope'
import { useFreshRead } from '#/queries/useFreshRead'
import type { AgentSubsectionId } from '#/navigation/app-route'
import { useReportRefreshing, useRetainedPollInterval, useServerScope } from '#/context'
import { Banner, Button, DisplayOnly, ReadState, SettingRow } from '#/components/ui'
import { ChatGPTSignIn } from '#/components/agents/ChatGPTSignIn'
import { PauseAllAgents } from '#/components/agents/PauseAllAgents'
import { PersonalClaudeCredential } from '#/components/agents/PersonalClaudeCredential'
import { useChatGPTSignIn } from '#/components/agents/useChatGPTSignIn'
import { usePersonalClaudeCredential } from '#/components/agents/usePersonalClaudeCredential'
import { newestRevision } from './newest-revision'
import { SettingsSection } from './SettingsSection'
import { SettingsSkeleton } from './SettingsSkeleton'
import { AgentSubsection, subsectionHeadingId } from './agents/AgentSubsection'
import { DescriptionsCard } from './agents/DescriptionsCard'
import { SlotMeter } from './agents/SlotMeter'
import { WebResearchForm } from './agents/WebResearchForm'
import { useReadiness } from '#/debug/useReadiness'
import { DescriptionStyleRow } from './agents/DescriptionStyleRow'
import { InstructionsForm } from './agents/InstructionsForm'
import { ProvidersAndSteps } from './agents/ProvidersAndSteps'
import { SessionsForm } from './agents/SessionsForm'
import { TagSuggestionsForm } from './agents/TagSuggestionsForm'
import { useDirtyForms } from './agents/useDirtyForms'
import { createSaveQueue } from './agents/save-queue'
import type { SettingsPage } from './agents/useSettingsSave'

type Props = {
  client: ReturnType<typeof agentsClient>
  /** Reports unsaved input, with how to save what can be saved before leaving. */
  onDirtyChange: (dirty: boolean, beforeLeave?: () => Promise<boolean>) => void
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
  // Says whether this profile's sessions have web access; until it answers, the form stays usable.
  const readiness = useReadiness(true)
  const settingsKey = serverQueryKey(scope, 'agent-settings')
  const settingsFresh = useFreshRead({
    queryKey: settingsKey,
    queryFn: () => client.settings(),
  })
  const settings = settingsFresh.query
  // The Agents page's list; its first page gives the slot use it shows too.
  const sessionsFresh = useFreshRead({
    queryKey: serverQueryKey(scope, 'agent-sessions', 'newest'),
    queryFn: () => client.sessions(),
    refetchInterval: poll === false ? 10000 : poll,
  })
  const sessions = sessionsFresh.query
  // Pause all sends no revision, so it waits for a list read started after the last live hint.
  const pauseReason = sessionsFresh.settledAfterHint
    ? undefined
    : (sessionsFresh.reason ?? 'Updating…')
  // Forms open only once a read has succeeded this visit, never on cached settings after a
  // failed one; a later failed refresh keeps them, and their drafts, open.
  const [readThisVisit, setReadThisVisit] = useState(false)
  if (!readThisVisit && settingsFresh.commandsReady) {
    setReadThisVisit(true)
  }
  const loaded = readThisVisit && settings.data
  const ready = Boolean(loaded)
  // Until then, settings cached from an earlier visit show read-only.
  const cached = loaded ? undefined : settings.data
  useReportRefreshing(settings.data !== undefined && settings.isFetching)
  const focused = useRef<AgentSubsectionId | undefined>(undefined)
  // Every subsection saves through one queue, which owns their debounces.
  const [queue] = useState(createSaveQueue)
  // Leaving the section drops saves still waiting for their pause; the guard flushes them first.
  useEffect(() => () => queue.dispose(), [queue])
  const reportDirty = useDirtyForms(onDirtyChange, async () => {
    await queue.flush()
    return !reportDirty.anyDirty()
  })
  // The newest settings a save or reload confirmed, ahead of the cache while it is updated.
  const newest = useRef<AgentSettingsDto | undefined>(undefined)
  // Revisions this page's own saves produced; an edit may move past those, never past others.
  const localSaves = useRef(new Set<string>())

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

  /**
   * Publishes confirmed settings and answers with what is current. A read that was already
   * running, or a reload older than a save confirmed meanwhile, never replaces newer settings.
   */
  function adoptLoaded(confirmed: AgentSettingsDto, source: 'save' | 'reload') {
    if (source === 'save') {
      localSaves.current.add(confirmed.revision)
    }
    const latest = newestRevision(
      confirmed,
      newest.current,
      queryClient.getQueryData<AgentSettingsDto>(settingsKey),
    )
    if (latest !== confirmed) {
      return latest
    }
    newest.current = confirmed
    void queryClient.cancelQueries({ queryKey: settingsKey }).then(() => {
      // Only the newest of several confirmations in flight is published.
      if (newest.current === confirmed) {
        queryClient.setQueryData(settingsKey, confirmed)
      }
    })
    return confirmed
  }

  const unavailable = (settings.isError || settings.fetchStatus === 'paused') && (
    <div role="alert">
      <Banner tone="warn" action={<Button onClick={() => void settings.refetch()}>Retry</Button>}>
        Settings unavailable. Unsaved input is preserved.
      </Banner>
    </div>
  )
  const waiting = settings.isError ? null : <SettingsSkeleton />
  const shown = loaded || cached
  const page: SettingsPage | undefined = shown
    ? {
        client,
        queue,
        newest: () =>
          newestRevision(
            shown,
            newest.current,
            queryClient.getQueryData<AgentSettingsDto>(settingsKey),
          ),
        adopt: adoptLoaded,
        ownSave: (revision) => localSaves.current.add(revision),
        localSaves: localSaves.current,
        reportDirty: reportDirty.report,
      }
    : undefined
  const form = shown && page && { page, loaded: shown }
  const sessionsSubsection = form ? (
    <SessionsForm
      {...form}
      slots={
        <SlotMeter
          list={sessions.data}
          failed={sessions.isError}
          limit={shown.session_concurrency}
        />
      }
      pause={
        <SettingRow
          label="Pause all agents"
          help="Paused batches keep their place and resume where they stopped."
        >
          <PauseAllAgents
            pauseAll={client.pauseAll}
            list={sessions.data}
            unavailableReason={pauseReason}
            readyNow={sessionsFresh.settledAfterHintNow}
          />
        </SettingRow>
      }
    />
  ) : (
    <AgentSubsection id="sessions">{waiting}</AgentSubsection>
  )

  const body = (
    <>
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
          <AgentSubsection id="providers">
            {waiting && (
              <ReadState phase="empty" skeleton={waiting}>
                {null}
              </ReadState>
            )}
          </AgentSubsection>
          {sessionsSubsection}
          <AgentSubsection id="models">{waiting}</AgentSubsection>
        </>
      )}
      <AgentSubsection id="instructions">
        {form ? <InstructionsForm {...form} /> : waiting}
      </AgentSubsection>
      <AgentSubsection
        id="descriptions"
        lead="How agents write the free-text fields InvenTree shows. Existing records keep their text unless you change it in Review."
      >
        <DescriptionsCard style={form ? <DescriptionStyleRow {...form} /> : waiting} />
      </AgentSubsection>
      {form ? (
        <TagSuggestionsForm {...form} />
      ) : (
        <AgentSubsection id="tags">{waiting}</AgentSubsection>
      )}
      {form ? (
        <WebResearchForm {...form} web={readiness.data?.web} />
      ) : (
        <AgentSubsection id="research">{waiting}</AgentSubsection>
      )}
    </>
  )

  return (
    <SettingsSection
      title="Agents"
      lead="Everything that shapes how agents work, for every batch. A running turn finishes with the settings it started with."
      agent
    >
      {unavailable}
      {cached ? <DisplayOnly>{body}</DisplayOnly> : body}
    </SettingsSection>
  )
}
