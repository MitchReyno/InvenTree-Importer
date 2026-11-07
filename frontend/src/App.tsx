import { AgentSettings } from './components/agents/AgentSettings'
import { AgentSessions } from './components/agents/AgentSessions'
import { PageTitle, Panel, Paragraph, Notice } from './components/ui/primitives'
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
import { color, space, typeVar } from './theme/generated/tokens'
import { Diagnostics } from './components/operations/Diagnostics'
import { HeaderStatus } from './components/masthead/HeaderStatus'
import { AppMasthead } from './components/masthead/AppMasthead'
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
        attention={attention}
        records={records}
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
          <AppMasthead
            route={route}
            readBatch={client?.read}
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
          <Main>{content}</Main>
          {manual && <Diagnostics />}
        </LiveUpdates>
      </ServerStateProvider>
    </AppShell>
  )
}

const AppShell = styled.div`
  max-width: 1600px;
  padding: 0 ${space[12]};
  margin: auto;
  @media (max-width: 700px) {
    padding: 0 ${space[6]};
  }
`
const Main = styled.main`
  margin: 0 auto ${space[8]} auto;
`

const SetupStatus = styled.span`
  font-size: ${typeVar.small.size};
  color: ${color.muted};
`
