import { AgentSettings } from './components/agents/AgentSettings'
import { Banner } from './components/ui/Banner'
import { AgentSessions } from './components/agents/AgentSessions'
import { PageTitle, Panel, Paragraph } from './components/ui/primitives'
import { Button } from './components/ui/Button'
import { useCallback, useMemo, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  agentsClient,
  attentionClient,
  recordsClient,
  captureClient,
  catalogueClient,
  inboxClient,
  headerClient,
  intakeClient,
  manualClient,
  mediaClient,
  operatorReviewClient,
  processingClient,
} from '@invimport/contracts/client'
import { ServerStateProvider } from './components/query/ServerStateProvider'
import { LiveUpdates } from './components/operations/LiveUpdates'
import { serverScopeIdentity } from './queries/scope'
import { Batches } from './components/batches/Batches'
import { Batch } from './components/batches/Batch'
import { GlobalStyle } from './components/GlobalStyle'
import styled from 'styled-components'
import { color, typeVar } from './theme/generated/tokens'
import { Main, PageContent } from './components/AppLayout'
import { pageWidthFor } from './navigation/batch-route'
import { appPage, routeBatchId } from './navigation/app-route'
import { Diagnostics } from './components/operations/Diagnostics'
import { HeaderStatus } from './components/masthead/HeaderStatus'
import { AppMasthead } from './components/masthead/AppMasthead'
import { useNavigationGuard } from './navigation/useNavigationGuard'
import {
  ApiClientsProvider,
  ConfirmationProvider,
  type ApiClients,
  CompactStatusContext,
  HeaderObservationsProvider,
} from './context'

export default function App() {
  const { route, navigationBlocked, onDirtyChange } = useNavigationGuard()
  const bootstrapQuery = useQuery({
    queryKey: ['bootstrap', location.origin],
    queryFn: () => intakeClient(location.origin).bootstrap(),
    staleTime: Infinity,
    refetchOnMount: false,
  })
  const refetchBootstrap = bootstrapQuery.refetch

  const refreshBootstrap = useCallback(() => {
    void refetchBootstrap()
  }, [refetchBootstrap])

  const bootstrapUnavailable = bootstrapQuery.isError || bootstrapQuery.fetchStatus === 'paused'
  const bootstrap = bootstrapQuery.data
  const actorId = bootstrap?.actor_id
  const targetId = bootstrap?.target_id
  const targetContextId = bootstrap?.target_context_id
  const scope = useMemo(
    () =>
      actorId && targetId && targetContextId
        ? {
            origin: location.origin,
            actorId,
            targetId,
            targetContextId,
          }
        : undefined,
    [actorId, targetId, targetContextId],
  )
  const client = useMemo(
    () =>
      bootstrap?.csrf_token
        ? {
            ...captureClient(location.origin, bootstrap.csrf_token),
            ...inboxClient(location.origin, bootstrap.csrf_token),
          }
        : null,
    [bootstrap],
  )
  const agents = useMemo(
    () => (bootstrap?.csrf_token ? agentsClient(location.origin, bootstrap.csrf_token) : null),
    [bootstrap],
  )
  const manual = useMemo(
    () => (bootstrap?.csrf_token ? manualClient(location.origin, bootstrap.csrf_token) : null),
    [bootstrap],
  )
  const processing = useMemo(
    () =>
      bootstrap?.csrf_token ? processingClient(location.origin, bootstrap.csrf_token) : undefined,
    [bootstrap],
  )
  const operator = useMemo(
    () =>
      bootstrap?.csrf_token
        ? operatorReviewClient(location.origin, bootstrap.csrf_token)
        : undefined,
    [bootstrap],
  )
  const catalogue = useMemo(
    () =>
      bootstrap?.csrf_token ? catalogueClient(location.origin, bootstrap.csrf_token) : undefined,
    [bootstrap],
  )
  const media = useMemo(
    () =>
      bootstrap?.csrf_token && bootstrap.media_enabled === true
        ? mediaClient(location.origin, bootstrap.csrf_token)
        : undefined,
    [bootstrap],
  )
  const attention = useMemo(
    () =>
      bootstrap?.csrf_token ? attentionClient(location.origin, bootstrap.csrf_token) : undefined,
    [bootstrap?.csrf_token],
  )
  const records = useMemo(
    () =>
      bootstrap?.csrf_token ? recordsClient(location.origin, bootstrap.csrf_token) : undefined,
    [bootstrap?.csrf_token],
  )
  const header = useMemo(
    () => (bootstrap?.csrf_token ? headerClient(location.origin, bootstrap.csrf_token) : null),
    [bootstrap?.csrf_token],
  )
  const apiClients = useMemo<ApiClients>(
    () => ({
      agents: agents ?? undefined,
      attention,
      catalogue,
      media,
      operator,
      processing,
      records,
    }),
    [agents, attention, catalogue, media, operator, processing, records],
  )
  const currentBatch = routeBatchId(route)
  const page = appPage(route)
  let content: ReactNode
  let batchPage = false
  if (bootstrapUnavailable && !bootstrap) {
    content = (
      <div role="alert">
        Application unavailable. Check the local API and retry.{' '}
        <Button onClick={() => location.reload()}>Retry connection</Button>
      </div>
    )
  } else if (!bootstrap) {
    content = <Paragraph role="status">Loading…</Paragraph>
  } else if (!client) {
    content = (
      <Panel>
        <PageTitle>Local setup required</PageTitle>
        <Paragraph>
          Configure the server-side development key reference and capture database. No browser
          credential entry is supported.
        </Paragraph>
        <Paragraph>
          Final identity and complete permission qualification are deferred to T11.
        </Paragraph>
      </Panel>
    )
  } else if (page === 'settings' && agents) {
    content = <AgentSettings client={agents} onDirtyChange={onDirtyChange} />
  } else if (page === 'agents' && agents) {
    content = (
      <AgentSessions
        client={agents}
        batches={async (batchId) => {
          const batch = await client.read(batchId)
          return {
            title: batch.title,
            subjects: new Map(
              [...batch.lots, ...batch.parts].map((subject) => [subject.id, subject.label]),
            ),
          }
        }}
      />
    )
  } else if (route && currentBatch && manual) {
    // A batch page draws its full-width header band, then centres its own content.
    batchPage = true
    content = (
      <Batch
        key={currentBatch}
        id={currentBatch}
        client={client}
        manual={manual}
        route={route}
        onDirtyChange={onDirtyChange}
      />
    )
  } else {
    content = <Batches client={client} onDirtyChange={onDirtyChange} />
  }
  const width = pageWidthFor(route ?? '')
  return (
    <>
      <GlobalStyle />
      <ServerStateProvider key={scope ? serverScopeIdentity(scope) : 'setup'} scope={scope}>
        <ConfirmationProvider>
          <ApiClientsProvider value={apiClients}>
            <LiveUpdates
              csrfToken={bootstrap?.csrf_token ?? null}
              batchId={currentBatch ?? null}
              showStatus={false}
              refreshBootstrap={refreshBootstrap}
            >
              <HeaderObservationsProvider
                client={header && scope ? header : null}
                batchId={currentBatch}
              >
                <AppMasthead
                  route={route}
                  status={
                    header && scope ? (
                      <HeaderStatus
                        client={header}
                        batchId={currentBatch}
                        bootstrapUnavailable={bootstrapUnavailable}
                      />
                    ) : (
                      <SetupStatus>
                        {bootstrap ? 'Local setup required' : 'Connecting to application…'}
                      </SetupStatus>
                    )
                  }
                />
                <CompactStatusContext.Provider
                  value={
                    header && scope ? (
                      <HeaderStatus
                        client={header}
                        batchId={currentBatch}
                        bootstrapUnavailable={bootstrapUnavailable}
                        variant="condensed"
                      />
                    ) : null
                  }
                >
                  <Main>
                    {((bootstrapUnavailable && bootstrap) || navigationBlocked) && (
                      <PageContent $width={width}>
                        {bootstrapUnavailable && bootstrap && (
                          <div role="alert">
                            <Banner tone="warn">
                              Application connection unavailable. Showing the last development
                              context; retained views report their own freshness. Unsaved input is
                              preserved.
                            </Banner>
                          </div>
                        )}
                        {navigationBlocked && (
                          <div role="alert">
                            <Banner tone="warn">
                              Your unsaved input is preserved. Save this form or discard its unsaved
                              input before navigating, then choose the destination again.
                            </Banner>
                          </div>
                        )}
                      </PageContent>
                    )}
                    {batchPage ? content : <PageContent $width={width}>{content}</PageContent>}
                    {manual && (
                      <PageContent $width={width}>
                        <Diagnostics />
                      </PageContent>
                    )}
                  </Main>
                </CompactStatusContext.Provider>
              </HeaderObservationsProvider>
            </LiveUpdates>
          </ApiClientsProvider>
        </ConfirmationProvider>
      </ServerStateProvider>
    </>
  )
}

const SetupStatus = styled.span`
  font-size: ${typeVar.small.size};
  color: ${color.muted};
`
