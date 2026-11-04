import { AgentSettings } from './components/agents/AgentSettings'
import { AgentSessions } from './components/agents/AgentSessions'
import { Button, PageTitle, Panel, Paragraph, Notice } from './components/ui/primitives'
import { useCallback, useMemo, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  agentsClient,
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
import { Diagnostics } from './components/operations/Diagnostics'
import { HeaderStatus } from './components/masthead/HeaderStatus'
import { Masthead } from './components/masthead/Masthead'
import { useNavigationGuard } from './navigation/useNavigationGuard'

export default function App() {
  const { route, navigationBlocked, onDirtyChange } = useNavigationGuard()
  const bootstrapQuery = useQuery({
    queryKey: ['bootstrap', location.origin],
    queryFn: () => intakeClient(location.origin).bootstrap(),
    staleTime: Infinity,
    refetchOnMount: false,
  })
  const refreshBootstrap = useCallback(() => {
    void bootstrapQuery.refetch()
  }, [bootstrapQuery.refetch])
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
  const header = useMemo(
    () => (bootstrap?.csrf_token ? headerClient(location.origin, bootstrap.csrf_token) : null),
    [bootstrap?.csrf_token],
  )
  const currentBatch =
    route === 'agents' || route === 'settings' ? undefined : route?.split('/')[0] || undefined
  let content: ReactNode
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
  } else if (route === 'settings' && agents) {
    content = <AgentSettings client={agents} onDirtyChange={onDirtyChange} />
  } else if (route === 'agents' && agents) {
    content = <AgentSessions client={agents} />
  } else if (route && manual) {
    content = (
      <Batch
        key={route.split('/')[0]}
        id={route.split('/')[0]}
        client={client}
        manual={manual}
        processing={processing}
        media={media}
        operator={operator}
        catalogue={catalogue}
        route={route}
        onDirtyChange={onDirtyChange}
      />
    )
  } else {
    content = <Batches client={client} onDirtyChange={onDirtyChange} />
  }
  return (
    <AppShell>
      <GlobalStyle />
      <ServerStateProvider key={scope ? serverScopeIdentity(scope) : 'setup'} scope={scope}>
        <LiveUpdates
          csrfToken={bootstrap?.csrf_token ?? null}
          batchId={currentBatch ?? null}
          showStatus={false}
          refreshBootstrap={refreshBootstrap}
        >
          <Masthead
            actions={
              header && scope ? (
                <HeaderStatus
                  client={header}
                  batchId={currentBatch}
                  bootstrapUnavailable={bootstrapUnavailable}
                />
              ) : (
                <span>{bootstrap ? 'Local setup required' : 'Connecting to application…'}</span>
              )
            }
          />
          <DevelopmentBanner>
            {bootstrap?.banner ?? 'Connecting to local application…'}
          </DevelopmentBanner>
          {bootstrapUnavailable && bootstrap && (
            <Notice role="alert">
              Application connection unavailable. Showing the last development context; retained
              views report their own freshness. Unsaved input is preserved.
            </Notice>
          )}
          {navigationBlocked && (
            <Notice role="alert">
              Your unsaved input is preserved. Save this form or discard its unsaved input before
              navigating, then choose the destination again.
            </Notice>
          )}
          <MainNav aria-label="Application">
            <a href="#">Batches</a>
            <a href="#agents">Agent sessions</a>
            <a href="#settings">Agent settings</a>
          </MainNav>
          <Main>{content}</Main>
          {manual && <Diagnostics />}
        </LiveUpdates>
      </ServerStateProvider>
      <Footer>
        Saved in the application database. Exact manual approvals can queue the separately
        supervised owned fake. Native agents require an explicitly supervised worker and a saved
        model default. Real inventory mutation remains unavailable.
      </Footer>
    </AppShell>
  )
}

const AppShell = styled.div`
  max-width: 1600px;
  padding: 0 24px;
  margin: auto;
  @media (max-width: 700px) {
    padding: 0 12px;
  }
`
const DevelopmentBanner = styled.p`
  padding: 5px 10px;
  margin: 6px 0;
  color: #644813;
  background: #fff3d8;
  border: 1px solid #e7d09c;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.5;
`
const Main = styled.main`
  margin: 10px auto;
`
const Footer = styled.footer`
  padding: 24px 0;
  border-top: 1px solid #d5dce5;
  font-size: 12px;
  color: #526179;
  line-height: 1.6;
`

const MainNav = styled.nav`
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
  margin: 16px 0;
`
