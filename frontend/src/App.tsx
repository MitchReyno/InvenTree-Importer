import { Button, PageTitle, Panel, Paragraph, Notice } from './components/ui/primitives'
import { useMemo, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { captureClient, intakeClient, manualClient } from '@invimport/contracts/client'
import { ServerStateProvider } from './components/query/ServerStateProvider'
import { serverScopeIdentity } from './queries/scope'
import { Batches } from './components/batches/Batches'
import { Batch } from './components/batches/Batch'
import { GlobalStyle } from './components/GlobalStyle'
import styled from 'styled-components'
import { ActivityIndicator } from './components/ui/ActivityIndicator'
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
  const bootstrapUnavailable = bootstrapQuery.isError || bootstrapQuery.fetchStatus === 'paused'
  const bootstrap = bootstrapQuery.data
  const scope = bootstrap
    ? {
        origin: location.origin,
        actorId: bootstrap.actor_id,
        targetId: bootstrap.target_id,
        targetContextId: bootstrap.target_context_id,
      }
    : undefined
  const client = useMemo(
    () => (bootstrap?.csrf_token ? captureClient(location.origin, bootstrap.csrf_token) : null),
    [bootstrap],
  )
  const manual = useMemo(
    () => (bootstrap?.csrf_token ? manualClient(location.origin, bootstrap.csrf_token) : null),
    [bootstrap],
  )
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
  } else if (route && manual) {
    content = (
      <Batch
        key={route.split('/')[0]}
        id={route.split('/')[0]}
        client={client}
        manual={manual}
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
      <Masthead />
      <DevelopmentBanner>
        {bootstrap?.banner ?? 'Connecting to local application…'}
      </DevelopmentBanner>
      <ServerStateProvider key={scope ? serverScopeIdentity(scope) : 'setup'} scope={scope}>
        {manual && <ActivityIndicator client={manual} />}
        {bootstrapUnavailable && bootstrap && (
          <Notice role="alert">
            Application connection unavailable. Showing the last development context; retained views
            report their own freshness. Unsaved input is preserved.
          </Notice>
        )}
        {navigationBlocked && (
          <Notice role="alert">
            Your unsaved input is preserved. Save this form or discard its unsaved input before
            navigating, then choose the destination again.
          </Notice>
        )}
        <Main>{content}</Main>
      </ServerStateProvider>
      <Footer>
        Saved in the application database, not this browser. Exact manual approvals can queue the
        separately supervised owned fake. Real inventory writes, uploads and research remain
        unavailable.
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
  padding: 8px 12px;
  color: #644813;
  background: #fff3d8;
  border: 1px solid #e7d09c;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.5;
`
const Main = styled.main`
  margin: 18px auto;
`
const Footer = styled.footer`
  padding: 24px 0;
  border-top: 1px solid #d5dce5;
  font-size: 12px;
  color: #526179;
  line-height: 1.6;
`
