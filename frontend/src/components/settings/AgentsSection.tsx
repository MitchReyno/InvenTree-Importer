import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { AgentProviderId, AgentSettingsDto } from '@invimport/contracts'
import type { agentsClient } from '@invimport/contracts/client'
import { serverQueryKey } from '#/queries/scope'
import { useFreshRead } from '#/queries/useFreshRead'
import type { AgentSubsectionId } from '#/navigation/app-route'
import { useReportRefreshing, useRetainedPollInterval, useServerScope } from '#/context'
import { Banner, Button, DisplayOnly, ReadState, SettingRow } from '#/components/ui'
import { ChatGPTSignIn } from '#/components/agents/ChatGPTSignIn'
import { PauseAllAgents } from '#/components/agents/PauseAllAgents'
import { PersonalClaudeCredential } from '#/components/agents/PersonalClaudeCredential'
import { useProviderStatus } from '#/components/agents/useProviderStatus'
import { useModelCatalog } from '#/agents/useModelCatalog'
import { newestRevision } from './newest-revision'
import { SettingsSection } from './SettingsSection'
import { SettingsSkeleton } from './SettingsSkeleton'
import { AgentSubsection, scrollToSubsection } from './agents/AgentSubsection'
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
import { sessionListKey } from '#/agents/session-list'
import { invalidateStartFreshReads } from '#/processing/start-fresh'

/** Each provider's newest sign-in change, numbered across visits so an older one never matches. */
type SignInOrder = Partial<Record<AgentProviderId, number>>

const NO_SIGN_IN_CHANGES: SignInOrder = {}

let signInChangeCount = 0

/** Every session, for the list's totals; no page or filter narrows them. */
const ALL_SESSIONS = { filter: 'all' } as const

/** What a confirmed Claude change leaves stored, or undefined when only the VM can say. */
function claudeState(configured: boolean | undefined) {
  if (configured === undefined) {
    return undefined
  }
  return configured ? 'saved' : 'not_saved'
}

type Props = {
  client: ReturnType<typeof agentsClient>
  /** Reports unsaved input, with how to save what can be saved before leaving. */
  onDirtyChange: (dirty: boolean, beforeLeave?: () => Promise<boolean>) => void
  /** The subsection the route points at; the page scrolls to it and focuses its heading. */
  subsection?: AgentSubsectionId
  /** Whether the route was written by scrolling, so the page is already at that subsection. */
  routeFromScroll?: boolean
  /** Called just before the page scrolls itself to the route's subsection. */
  beforeScroll?: () => void
}

/**
 * Settings › Agents: every setting that shapes agent behaviour, in subsections. The providers'
 * sign-in status is read here, so it is read each time the section opens.
 */
export function AgentsSection({
  client,
  onDirtyChange,
  subsection,
  routeFromScroll = false,
  beforeScroll,
}: Props) {
  const scope = useServerScope()
  const poll = useRetainedPollInterval()
  const providerStatus = useProviderStatus(client)
  // Shared with Processing; a sign-in change marks it stale before the dialog confirms.
  const catalog = useModelCatalog(client)
  // Each provider's newest sign-in change, kept with the status read so it outlives this visit.
  const signInOrderKey = serverQueryKey(scope, 'provider-status', 'sign-in-order')
  useQuery({
    queryKey: signInOrderKey,
    queryFn: () => NO_SIGN_IN_CHANGES,
    enabled: false,
    initialData: NO_SIGN_IN_CHANGES,
    staleTime: Infinity,
    gcTime: Infinity,
  })
  const queryClient = useQueryClient()
  // Says whether this profile's sessions have web access; until it answers, the form stays usable.
  const readiness = useReadiness(true)
  const settingsKey = serverQueryKey(scope, 'agent-settings')
  const settingsFresh = useFreshRead({
    queryKey: settingsKey,
    queryFn: () => client.settings(),
  })
  const settings = settingsFresh.query
  // The session list's totals count every session, whatever page or filter the list shows.
  const sessionsFresh = useFreshRead({
    queryKey: sessionListKey(scope, ALL_SESSIONS),
    queryFn: () => client.sessions(ALL_SESSIONS),
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
    if (routeFromScroll) {
      // The operator scrolled here; the page is in place and focus stays where it is.
      focused.current = subsection
      return
    }
    // Loading the settings replaces the first subsections' headings; focus follows the new one
    // only when it was lost with the old, never taking it from where the operator moved it.
    const lost = document.activeElement === document.body
    if (focused.current === subsection && !lost) {
      return
    }
    beforeScroll?.()
    scrollToSubsection(subsection)
    focused.current = subsection
  }, [subsection, ready, routeFromScroll, beforeScroll])

  /**
   * A sign-in change the VM confirmed: the provider's subscription list is marked as from an
   * earlier sign-in first, then the card shows the change. A newer change made meanwhile wins, so
   * an older continuation never publishes over it; a late answer to a closed dialog never
   * displaces a newer one.
   */
  async function afterSignInChange(
    provider: AgentProviderId,
    { late = false }: { late?: boolean },
    publish: () => void,
  ) {
    const newest = () => queryClient.getQueryData<SignInOrder>(signInOrderKey)?.[provider]

    if (!late) {
      signInChangeCount += 1
      const change = signInChangeCount
      queryClient.setQueryData<SignInOrder>(signInOrderKey, (order = NO_SIGN_IN_CHANGES) => ({
        ...order,
        [provider]: change,
      }))
    }
    const mine = newest()
    await catalog.signInChanged(provider, 'subscription', { late })
    if (newest() === mine) {
      publish()
    }
  }

  /** Reads a confirmed save changes: Start fresh's eligibility, and which list each sign-in has. */
  function readAfterSave() {
    invalidateStartFreshReads(queryClient, scope)
    void queryClient.invalidateQueries({
      queryKey: serverQueryKey(scope, 'model-catalog'),
      exact: true,
    })
  }

  /**
   * Publishes confirmed settings and answers with what is current. A read that was already
   * running, or a reload older than a save confirmed meanwhile, never replaces newer settings.
   */
  function adoptLoaded(confirmed: AgentSettingsDto, source: 'save' | 'reload') {
    if (source === 'save') {
      localSaves.current.add(confirmed.revision)
      readAfterSave()
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
        ownSave: (revision) => {
          localSaves.current.add(revision)
          readAfterSave()
        },
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
          status={providerStatus}
          catalog={catalog}
          credentials={{
            claude: (
              <PersonalClaudeCredential
                onChanged={(configured, late) =>
                  afterSignInChange('claude', { late }, () =>
                    providerStatus.signInChanged('claude', claudeState(configured), { late }),
                  )
                }
              />
            ),
            codex: (
              <ChatGPTSignIn
                onConfirmed={() =>
                  afterSignInChange('codex', {}, () =>
                    providerStatus.signInChanged('codex', 'signed_in'),
                  )
                }
                onChanged={() =>
                  void afterSignInChange('codex', {}, () => providerStatus.signInChanged('codex'))
                }
              />
            ),
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
